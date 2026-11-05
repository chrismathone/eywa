"use server";

import { revalidatePath } from "next/cache";
import { documentFileName, titleWithFileExtension } from "../file-name";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import {
  createUploadTicket,
  MEDIA_KIND,
  removeObject,
  resolveTenantReadUrl,
  verifyUploadedObject,
} from "@/lib/storage/media-storage";
import { isTenantDocumentPath } from "@/lib/storage/legacy-audio-path";
import { humanizeDbError, logDbError } from "@/lib/supabase/db-error";
import type { UploadTicket } from "@/lib/storage/types";
import { RESUME_FORM_TYPE } from "@/features/staff/resume/resume";
import { canViewResume, RESUME_LOCKED_MSG } from "@/features/staff/resume/server/resume-access";
import { logAction } from "@/features/audit/server/log";
import { FALLBACK_CATEGORY, normalizeLinkUrl } from "../categories";
import { getDocumentCategories } from "./category-queries";
import { hideRestrictedDocuments } from "./restricted";

// 데이터베이스(서식 저장소) 변경 액션 — 쓰기는 canWriteTenant("documents")(master/admin/manager),
// 다운로드(읽기)는 canAccessTenant(readonly 강사·상담·회계도 빈 양식을 받아야 하므로).
// '다른 강사 뷰'면 행위자는 대상 X — 등록자 명의(uploaded_by)는 X, 감사로그(logAction)는 실제 로그인 계정이 남는다.
// 제한 문서(restricted)는 행위자 역할로 한 번 더 거른다 — DB는 실제 로그인 계정 역할로만 거른다(restricted.ts).

export type DocTicketState = { ticket?: UploadTicket; error?: string } | undefined;
export type DocActionState = { ok?: boolean; error?: string; id?: string; nonce?: number } | undefined;

async function requireDocumentWrite() {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" as const };
  if (!(await canWriteTenant(user.systemRole, "documents"))) {
    return { error: "서식 관리 권한이 없습니다" as const };
  }
  return { user };
}

/**
 * 분류 검증 — 0161a부터 분류가 테넌트 데이터라 코드 배열이 아니라 **DB 목록**과 대조한다.
 * ⚠️ 없는 키를 조용히 '기타'로 바꾸지 않고 에러를 돌려준다: 화면 드롭다운은 항상 유효한 키만 보내므로,
 *    안 맞는 값이 왔다는 건 삭제 레이스이거나 진짜 버그다. 조용한 폴백은 그걸 "저장됨"으로 위장한다.
 */
async function parseCategory(v: unknown): Promise<{ category: string } | { error: string }> {
  const raw = String(v ?? "").trim() || FALLBACK_CATEGORY;
  const options = await getDocumentCategories();
  if (options.some((o) => o.key === raw)) return { category: raw };
  return { error: "없는 분류입니다 — 목록을 새로고침한 뒤 다시 선택해 주세요" };
}

/** ① 업로드 티켓 발급 — 경로는 서버가 빌드(`{tenantId}/documents/{uuid}.{ext}`), 원본 파일명은 DB에만. */
export async function issueDocumentUploadTicket(
  _prev: DocTicketState,
  formData: FormData,
): Promise<DocTicketState> {
  const gate = await requireDocumentWrite();
  if ("error" in gate) return { error: gate.error };

  const contentType = String(formData.get("contentType") ?? "");
  if (!MEDIA_KIND.document.allowCT(contentType)) {
    return { error: "허용되지 않는 파일 형식입니다 (이미지·PDF·오피스·한글 문서)" };
  }
  const size = Number(formData.get("size") ?? 0);
  if (!Number.isFinite(size) || size <= 0 || size > MEDIA_KIND.document.maxBytes) {
    return { error: "파일이 너무 큽니다 (최대 20MB)" };
  }
  const ext = String(formData.get("ext") ?? "").toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  const path = `${gate.user.tenantId}/documents/${crypto.randomUUID()}.${ext}`;
  if (!isTenantDocumentPath(path, gate.user.tenantId)) return { error: "경로 생성 실패" };

  try {
    return { ticket: await createUploadTicket({ kind: "document", path, contentType }) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "업로드 티켓 발급 실패" };
  }
}

/** ② 업로드 완료 등록 — 객체 진실성 검증(verifyUploadedObject) 통과분만 DB행 생성, 실패 시 cleanup. */
export async function registerUploadedDocument(
  _prev: DocActionState,
  formData: FormData,
): Promise<DocActionState> {
  const gate = await requireDocumentWrite();
  if ("error" in gate) return { error: gate.error };

  const path = String(formData.get("path") ?? "");
  if (!isTenantDocumentPath(path, gate.user.tenantId)) return { error: "잘못된 파일 경로입니다" };
  const rawTitle = String(formData.get("title") ?? "").trim();
  if (!rawTitle) return { error: "이름을 입력하세요" };
  const fileName = String(formData.get("fileName") ?? "").trim() || null;
  const title = titleWithFileExtension(rawTitle, fileName ?? path.split("/").pop() ?? null);
  const description = String(formData.get("description") ?? "").trim() || null;
  // 분류 검증은 스토리지 검증 전에 — 못 쓸 값이면 업로드된 객체를 여기서 바로 회수한다(고아 객체 방지).
  const cat = await parseCategory(formData.get("category"));
  if ("error" in cat) {
    await removeObject(path, { bucket: MEDIA_KIND.document.supabaseBucket }).catch(() => {});
    return { error: cat.error };
  }

  let verified: { size: number; contentType: string };
  try {
    verified = await verifyUploadedObject("document", path);
  } catch (e) {
    await removeObject(path, { bucket: MEDIA_KIND.document.supabaseBucket }).catch(() => {});
    return { error: e instanceof Error ? e.message : "업로드 검증 실패" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("academy_documents")
    .insert({
      tenant_id: gate.user.tenantId,
      title,
      category: cat.category,
      kind: "file",
      description,
      file_path: path,
      file_name: fileName,
      file_size: verified.size || Number(formData.get("size") ?? 0) || null,
      mime_type: verified.contentType || String(formData.get("contentType") ?? "") || null,
      uploaded_by: gate.user.id,
    })
    .select("id")
    .single();
  if (error || !data) {
    await removeObject(path, { bucket: MEDIA_KIND.document.supabaseBucket }).catch(() => {});
    return { error: `등록 실패: ${error?.message ?? "unknown"}` };
  }
  await logAction({
    action: "document_create",
    targetType: "document",
    targetLabel: title,
    metadata: {
      documentId: data.id,
      kind: "file",
      category: cat.category,
      fileName,
      fileSize: verified.size || null,
      mimeType: verified.contentType || null,
    },
  });
  revalidatePath("/documents");
  return { ok: true, id: data.id, nonce: Date.now() };
}

/** 앱 작성 문서(kind='text') 생성. */
export async function createTextDocument(
  _prev: DocActionState,
  formData: FormData,
): Promise<DocActionState> {
  const gate = await requireDocumentWrite();
  if ("error" in gate) return { error: gate.error };

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { error: "제목을 입력하세요" };
  const body = String(formData.get("body") ?? "").trim();
  if (!body) return { error: "내용을 입력하세요" };
  const cat = await parseCategory(formData.get("category"));
  if ("error" in cat) return { error: cat.error };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("academy_documents")
    .insert({
      tenant_id: gate.user.tenantId,
      title,
      category: cat.category,
      kind: "text",
      description: String(formData.get("description") ?? "").trim() || null,
      body,
      uploaded_by: gate.user.id,
    })
    .select("id")
    .single();
  if (error || !data) return { error: `저장 실패: ${error?.message ?? "unknown"}` };
  // 🔴 본문(body)은 담지 않는다 — 감사로그는 "누가 언제"를 남기는 곳이고 내용은 문서 행이 갖는다.
  await logAction({
    action: "document_create",
    targetType: "document",
    targetLabel: title,
    metadata: { documentId: data.id, kind: "text", category: cat.category },
  });
  revalidatePath("/documents");
  return { ok: true, id: data.id, nonce: Date.now() };
}

/**
 * 외부 링크 문서(kind='link') 등록 — 이미 구글드라이브·노션 등에 있는 자료를 **재업로드 없이** 목록에 올린다.
 * 파일 사본을 만들지 않으므로 원본이 진실이고 여기선 이름·분류·설명만 우리가 갖는다(연동 폴더와 같은 원칙).
 * ⚠️ 링크가 살아 있는지, 학부모/직원이 열 권한이 있는지는 대상 서비스가 판단한다 — 우리가 보증하지 않는다.
 */
export async function createLinkDocument(
  _prev: DocActionState,
  formData: FormData,
): Promise<DocActionState> {
  const gate = await requireDocumentWrite();
  if ("error" in gate) return { error: gate.error };

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { error: "이름을 입력하세요" };
  // javascript:/data: 차단 + 스킴 보정은 순수 함수 한 곳에서(Vitest로 잠금).
  const link = normalizeLinkUrl(String(formData.get("linkUrl") ?? ""));
  if ("error" in link) return { error: link.error };
  const cat = await parseCategory(formData.get("category"));
  if ("error" in cat) return { error: cat.error };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("academy_documents")
    .insert({
      tenant_id: gate.user.tenantId,
      title,
      category: cat.category,
      kind: "link",
      description: String(formData.get("description") ?? "").trim() || null,
      link_url: link.url,
      uploaded_by: gate.user.id,
    })
    .select("id")
    .single();
  if (error || !data) return { error: `등록 실패: ${error?.message ?? "unknown"}` };
  await logAction({
    action: "document_create",
    targetType: "document",
    targetLabel: title,
    metadata: { documentId: data.id, kind: "link", category: cat.category, linkUrl: link.url },
  });
  revalidatePath("/documents");
  return { ok: true, id: data.id, nonce: Date.now() };
}

/** 제목·분류·설명(+text면 본문) 수정. */
export async function updateDocument(
  _prev: DocActionState,
  formData: FormData,
): Promise<DocActionState> {
  const gate = await requireDocumentWrite();
  if ("error" in gate) return { error: gate.error };

  const id = String(formData.get("id") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  if (!id || !title) return { error: "잘못된 요청입니다" };

  const cat = await parseCategory(formData.get("category"));
  if ("error" in cat) return { error: cat.error };

  const [supabase, hideRestricted] = await Promise.all([createClient(), hideRestrictedDocuments()]);
  let currentQuery = supabase
    .from("academy_documents")
    .select("kind, file_name, file_path")
    .eq("id", id)
    .eq("tenant_id", gate.user.tenantId)
    .is("staff_user_id", null);
  if (hideRestricted) currentQuery = currentQuery.eq("restricted", false);
  const { data: current, error: currentError } = await currentQuery.maybeSingle();
  if (currentError || !current) {
    logDbError(currentError, "documents.updateDocument");
    return { error: "문서를 찾을 수 없습니다" };
  }
  const savedTitle = current.kind === "file"
    ? titleWithFileExtension(title, current.file_name ?? current.file_path?.split("/").pop() ?? null)
    : title;
  const patch: Record<string, unknown> = {
    title: savedTitle,
    category: cat.category,
    description: String(formData.get("description") ?? "").trim() || null,
    updated_at: new Date().toISOString(),
  };
  if (formData.has("body")) {
    const body = String(formData.get("body") ?? "").trim();
    if (!body) return { error: "내용을 입력하세요" };
    patch.body = body;
  }
  if (formData.has("linkUrl")) {
    const link = normalizeLinkUrl(String(formData.get("linkUrl") ?? ""));
    if ("error" in link) return { error: link.error };
    patch.link_url = link.url;
  }

  // 직원 연결 문서(이력서·계약서)는 이 표면에서 조작 불가(#77) — 관리도 /staff 쪽 전용 액션으로만.
  let updateQuery = supabase
    .from("academy_documents")
    .update(patch)
    .eq("id", id)
    .is("staff_user_id", null);
  if (hideRestricted) updateQuery = updateQuery.eq("restricted", false);
  // ⚠️ select 없이 로그를 남기면 0행 갱신(없는 id·이력서 id)도 "고쳤다"고 적힌다 — 감사로그가
  //    실제로 없었던 변경을 주장하면 역검수가 오히려 틀린 곳을 가리킨다. 바뀐 행이 있을 때만 남긴다.
  const { data: updated, error } = await updateQuery.select("id");
  if (error) return { error: `수정 실패: ${error.message}` };
  if (updated?.length) {
    await logAction({
      action: "document_update",
      targetType: "document",
      targetLabel: savedTitle,
      metadata: {
        documentId: id,
        category: cat.category,
        ...(formData.has("body") ? { bodyEdited: true } : {}),
        ...(patch.link_url ? { linkUrl: patch.link_url } : {}),
      },
    });
  }
  revalidatePath("/documents");
  revalidatePath(`/documents/${id}`);
  return { ok: true, id, nonce: Date.now() };
}

/** 삭제 — DB행 삭제 후 스토리지 객체는 best-effort 정리. */
export async function deleteDocument(id: string): Promise<{ ok?: boolean; error?: string }> {
  const gate = await requireDocumentWrite();
  if ("error" in gate) return { error: gate.error };

  const [supabase, hideRestricted] = await Promise.all([createClient(), hideRestrictedDocuments()]);
  let rowQuery = supabase
    .from("academy_documents")
    .select("title, kind, category, file_path, form_type, uploaded_by")
    .eq("id", id)
    .is("staff_user_id", null); // 직원 연결 문서는 여기서 안 지운다(#77) — 이력서는 deleteStaffResume 전용
  if (hideRestricted) rowQuery = rowQuery.eq("restricted", false);
  const { data: row } = await rowQuery.maybeSingle();

  // ⚠️ 이력서는 같은 행이 여기(탐색기)에도 뜨지만 **열람은 원장·관리자로 잠겨 있다**(재인증 제거 2026-07-28) —
  // 열람 못 하는 이력서를 이 경로로 삭제할 수 있으면 잠금이 무의미해진다(2026-07-15 적대검수 실적발). 같은 게이트를 건다.
  if (row?.form_type === RESUME_FORM_TYPE) {
    const ok = await canViewResume(gate.user);
    if (!ok) return { error: RESUME_LOCKED_MSG };
  }

  let deleteQuery = supabase
    .from("academy_documents")
    .delete()
    .eq("id", id)
    .is("staff_user_id", null);
  // 못 보는 제한 문서는 못 지운다 — 위 조회와 같은 벽(안 그러면 목록에 없는 행을 id로 지울 수 있다).
  if (hideRestricted) deleteQuery = deleteQuery.eq("restricted", false);
  const { data: deleted, error } = await deleteQuery.select("id"); // select 없으면 0행 삭제도 성공으로 보고된다.
  if (error) return { error: humanizeDbError(error.message, "삭제") };
  if (!deleted?.length) return { error: "문서를 찾을 수 없습니다 — 이미 삭제되었을 수 있습니다" };
  // 🔴 지운 뒤엔 이름을 되찾을 곳이 없다 — 삭제 직전 제목을 그대로 스냅샷으로 남긴다(id만 남으면
  //    나중에 그게 무슨 서식이었는지 아무도 모른다). 이력서라도 담는 건 제목까지 — form_data는 절대 안 담는다.
  await logAction({
    action: "document_delete",
    targetType: "document",
    targetLabel: row?.title ?? null,
    metadata: {
      documentId: id,
      kind: row?.kind ?? null,
      category: row?.category ?? null,
      hadFile: Boolean(row?.file_path),
      uploadedBy: row?.uploaded_by ?? null,
    },
  });
  if (row?.file_path) await removeObject(row.file_path, { bucket: MEDIA_KIND.document.supabaseBucket }).catch(() => {});
  revalidatePath("/documents");
  return { ok: true };
}

/**
 * 열람/다운로드용 signed URL — 읽기 액션(readonly도 허용, 서식 배포가 목적). RLS가 테넌트 격리.
 * download는 파일명을 명시하는 같은 출처 라우트, view는 서버·외부 뷰어용 스토리지 서명 URL이다.
 */
export async function signDocumentUrl(
  id: string,
  mode: "view" | "download" = "view",
): Promise<{ url?: string; fileName?: string; error?: string }> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canAccessTenant(user.systemRole, "documents"))) return { error: "접근 권한이 없습니다" };

  const [supabase, hideRestricted] = await Promise.all([createClient(), hideRestrictedDocuments()]);
  let rowQuery = supabase
    .from("academy_documents")
    .select("title, file_path, file_name")
    .eq("id", id)
    .is("staff_user_id", null); // 직원 연결 문서는 전용 서명 경로(signStaffContractFileUrl)만(#77)
  // 🔴 제한 문서는 행위자 역할로 — 강사뷰에서 원장 토큰으로 서명하면 강사 X에게 계좌·금액 문서가 내려받아졌다.
  //    다운로드 라우트(/api/documents/[id]/file)도 이 함수를 지나므로 같은 벽이다.
  if (hideRestricted) rowQuery = rowQuery.eq("restricted", false);
  const { data: row } = await rowQuery.maybeSingle();
  if (!row?.file_path) return { error: "파일이 없는 문서입니다" };
  try {
    const fileName = documentFileName(row.file_name, row.title, row.file_path);
    return {
      url: mode === "download"
        ? `/api/documents/${encodeURIComponent(id)}/file?download=1`
        : await resolveTenantReadUrl(row.file_path, "document", user.tenantId),
      fileName,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "다운로드 URL 생성 실패" };
  }
}

/** 상단 고정 토글 — 자주 쓰는 서식을 목록 맨 위에(pinned desc 정렬). */
export async function toggleDocumentPin(
  id: string,
  pinned: boolean,
): Promise<{ ok?: boolean; error?: string }> {
  const gate = await requireDocumentWrite();
  if ("error" in gate) return { error: gate.error };

  const [supabase, hideRestricted] = await Promise.all([createClient(), hideRestrictedDocuments()]);
  let pinQuery = supabase
    .from("academy_documents")
    .update({ pinned, updated_at: new Date().toISOString() })
    .eq("id", id)
    .is("staff_user_id", null);
  if (hideRestricted) pinQuery = pinQuery.eq("restricted", false);
  const { data: updated, error } = await pinQuery.select("id, title"); // 제목은 로그 라벨용 — 같은 왕복에서 받아 온다(추가 조회 0).
  if (error) return { error: `고정 변경 실패: ${error.message}` };
  if (updated?.length) {
    await logAction({
      action: "document_pin",
      targetType: "document",
      targetLabel: updated[0].title ?? null,
      metadata: { documentId: id, pinned },
    });
  }
  revalidatePath("/documents");
  return { ok: true };
}
