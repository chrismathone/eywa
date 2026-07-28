"use server";

import { revalidatePath } from "next/cache";
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
import { humanizeDbError } from "@/lib/supabase/db-error";
import type { UploadTicket } from "@/lib/storage/types";
import { RESUME_FORM_TYPE } from "@/features/staff/resume";
import { canViewResume, RESUME_LOCKED_MSG } from "@/features/staff/server/resume-access";
import { DOCUMENT_CATEGORIES } from "../categories";

// 데이터베이스(서식 저장소) 변경 액션 — 쓰기는 canWriteTenant("documents")(master/admin/manager),
// 다운로드(읽기)는 canAccessTenant(readonly 강사·상담·회계도 빈 양식을 받아야 하므로).

export type DocTicketState = { ticket?: UploadTicket; error?: string } | undefined;
export type DocActionState = { ok?: boolean; error?: string; id?: string; nonce?: number } | undefined;

async function requireDocumentWrite() {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" as const };
  if (!(await canWriteTenant(user.systemRole, "documents"))) {
    return { error: "서식 관리 권한이 없습니다" as const };
  }
  return { user };
}

const parseCategory = (v: unknown) =>
  (DOCUMENT_CATEGORIES as readonly string[]).includes(String(v)) ? String(v) : "other";

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
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { error: "이름을 입력하세요" };
  const fileName = String(formData.get("fileName") ?? "").trim() || null;
  const description = String(formData.get("description") ?? "").trim() || null;

  let verified: { size: number; contentType: string };
  try {
    verified = await verifyUploadedObject("document", path);
  } catch (e) {
    await removeObject(path).catch(() => {});
    return { error: e instanceof Error ? e.message : "업로드 검증 실패" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("academy_documents")
    .insert({
      tenant_id: gate.user.tenantId,
      title,
      category: parseCategory(formData.get("category")),
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
    await removeObject(path).catch(() => {});
    return { error: `등록 실패: ${error?.message ?? "unknown"}` };
  }
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

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("academy_documents")
    .insert({
      tenant_id: gate.user.tenantId,
      title,
      category: parseCategory(formData.get("category")),
      kind: "text",
      description: String(formData.get("description") ?? "").trim() || null,
      body,
      uploaded_by: gate.user.id,
    })
    .select("id")
    .single();
  if (error || !data) return { error: `저장 실패: ${error?.message ?? "unknown"}` };
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

  const patch: Record<string, unknown> = {
    title,
    category: parseCategory(formData.get("category")),
    description: String(formData.get("description") ?? "").trim() || null,
    updated_at: new Date().toISOString(),
  };
  if (formData.has("body")) {
    const body = String(formData.get("body") ?? "").trim();
    if (!body) return { error: "내용을 입력하세요" };
    patch.body = body;
  }

  const supabase = await createClient();
  const { error } = await supabase.from("academy_documents").update(patch).eq("id", id);
  if (error) return { error: `수정 실패: ${error.message}` };
  revalidatePath("/documents");
  revalidatePath(`/documents/${id}`);
  return { ok: true, id, nonce: Date.now() };
}

/** 삭제 — DB행 삭제 후 스토리지 객체는 best-effort 정리. */
export async function deleteDocument(id: string): Promise<{ ok?: boolean; error?: string }> {
  const gate = await requireDocumentWrite();
  if ("error" in gate) return { error: gate.error };

  const supabase = await createClient();
  const { data: row } = await supabase
    .from("academy_documents")
    .select("file_path, form_type, uploaded_by")
    .eq("id", id)
    .maybeSingle();

  // ⚠️ 이력서는 같은 행이 여기(탐색기)에도 뜨지만 **열람은 원장·관리자로 잠겨 있다**(재인증 제거 2026-07-28) —
  // 열람 못 하는 이력서를 이 경로로 삭제할 수 있으면 잠금이 무의미해진다(2026-07-15 적대검수 실적발). 같은 게이트를 건다.
  if (row?.form_type === RESUME_FORM_TYPE) {
    const ok = await canViewResume(gate.user);
    if (!ok) return { error: RESUME_LOCKED_MSG };
  }

  const { data: deleted, error } = await supabase
    .from("academy_documents")
    .delete()
    .eq("id", id)
    .select("id"); // select 없으면 0행 삭제도 성공으로 보고된다.
  if (error) return { error: humanizeDbError(error.message, "삭제") };
  if (!deleted?.length) return { error: "문서를 찾을 수 없습니다 — 이미 삭제되었을 수 있습니다" };
  if (row?.file_path) await removeObject(row.file_path).catch(() => {});
  revalidatePath("/documents");
  return { ok: true };
}

/**
 * 열람/다운로드용 signed URL — 읽기 액션(readonly도 허용, 서식 배포가 목적). RLS가 테넌트 격리.
 * mode="download"면 attachment disposition(원본 파일명으로 저장), "view"면 inline(브라우저 미리보기).
 */
export async function signDocumentUrl(
  id: string,
  mode: "view" | "download" = "view",
): Promise<{ url?: string; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canAccessTenant(user.systemRole, "documents"))) return { error: "접근 권한이 없습니다" };

  const supabase = await createClient();
  const { data: row } = await supabase
    .from("academy_documents")
    .select("file_path, file_name")
    .eq("id", id)
    .maybeSingle();
  if (!row?.file_path) return { error: "파일이 없는 문서입니다" };
  try {
    const downloadName =
      mode === "download" ? (row.file_name ?? row.file_path.split("/").pop() ?? "document") : undefined;
    return {
      url: await resolveTenantReadUrl(row.file_path, "document", user.tenantId, undefined, downloadName),
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

  const supabase = await createClient();
  const { error } = await supabase
    .from("academy_documents")
    .update({ pinned, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: `고정 변경 실패: ${error.message}` };
  revalidatePath("/documents");
  return { ok: true };
}
