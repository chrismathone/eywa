"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { createAdminClient } from "@/lib/supabase/admin";
import { MEDIA_KIND, removeObject, resolveTenantReadUrl } from "@/lib/storage/media-storage";
import { isTenantDocumentPath } from "@/lib/storage/legacy-audio-path";
import { humanizeDbError } from "@/lib/supabase/db-error";
import { logAction } from "@/features/audit/server/log";

// 계약서 원본 보관(원장 지시 2026-08-03) — 직원 상세 '계약현황'에서 PDF를 올려 직원에게 붙여 둔다.
// 저장소는 academy_documents 행(kind='file' + staff_user_id + restricted) 재사용 — 새 테이블·SQL 없음.
// ⚠️ 직원 연결 문서(staff_user_id 有)는 데이터베이스(/documents) 표면에서 **제외**된다(#77 — 직원관리는
// 4인 체제인데 documents는 사무실 전역이라, 거기 뜨면 잠금이 무의미해진다). 열람·관리는 여기(직원관리)뿐.
// 게이트는 전부 앱(개인 예외 반영 perm-matrix) + admin client + tenant 명시 필터(0170a 보류 중 패턴).

export type ContractFileActionState = { ok?: true; error?: string; notice?: string } | undefined;

async function requireStaffWrite() {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" as const };
  if (!(await canWriteTenant(user.systemRole, "staff"))) return { error: "계약서를 관리할 권한이 없습니다" as const };
  return { user };
}

/**
 * 올린 PDF를 그 직원의 계약서로 등록한다(티켓 업로드 후 호출).
 * 같은 직원에게 여러 부 보관 가능 — 갱신 계약·부속 합의서가 쌓이는 게 정상이라 개수 제한을 두지 않는다.
 */
export async function registerStaffContractFile(
  _prev: ContractFileActionState,
  formData: FormData,
): Promise<ContractFileActionState> {
  const gate = await requireStaffWrite();
  if ("error" in gate) return { error: gate.error };

  const userId = String(formData.get("userId") ?? "").trim();
  const path = String(formData.get("path") ?? "").trim();
  const fileName = String(formData.get("fileName") ?? "").trim() || "계약서.pdf";
  const fileSize = Number(formData.get("fileSize") ?? 0);
  if (!userId) return { error: "직원을 찾을 수 없습니다" };
  if (!path || !isTenantDocumentPath(path, gate.user.tenantId)) {
    return { error: "파일 경로가 올바르지 않습니다 — 다시 첨부하세요" };
  }

  const admin = createAdminClient();
  // 대상 재확인(폼 변조 차단) — admin client라 tenant 대조가 격리의 전부.
  const { data: target, error: targetErr } = await admin
    .from("users")
    .select("id, display_name, tenant_id")
    .eq("id", userId)
    .maybeSingle();
  if (targetErr) return { error: humanizeDbError(targetErr.message, "확인") };
  if (!target || target.tenant_id !== gate.user.tenantId) return { error: "직원을 찾을 수 없습니다" };

  const { error } = await admin.from("academy_documents").insert({
    tenant_id: gate.user.tenantId,
    title: `계약서 — ${target.display_name}`,
    category: "hr", // 이력서와 같은 시스템 분류(문서 화면엔 안 뜨지만 데이터 일관성 유지)
    kind: "file",
    file_path: path,
    file_name: fileName,
    file_size: Number.isFinite(fileSize) && fileSize > 0 ? Math.floor(fileSize) : null,
    mime_type: "application/pdf",
    restricted: true, // 사무실 전용 RLS 백스톱(0148a) — 강사/뷰어 토큰 직결 차단
    staff_user_id: userId,
    uploaded_by: gate.user.id,
  });
  if (error) return { error: humanizeDbError(error.message, "저장") };

  await logAction({
    action: "staff_contract_file_add",
    targetType: "user",
    targetLabel: target.display_name ?? null,
    metadata: { fileName },
  });
  revalidatePath(`/staff/${userId}`);
  revalidatePath("/staff");
  return { ok: true, notice: "계약서를 보관했습니다" };
}

/** 보관된 계약서 삭제 — 행과 스토리지 원본을 함께 지운다(잘못 올린 파일 정리). */
export async function deleteStaffContractFile(
  _prev: ContractFileActionState,
  formData: FormData,
): Promise<ContractFileActionState> {
  const gate = await requireStaffWrite();
  if ("error" in gate) return { error: gate.error };

  const docId = String(formData.get("docId") ?? "").trim();
  const userId = String(formData.get("userId") ?? "").trim();
  if (!docId || !userId) return { error: "삭제할 계약서를 찾을 수 없습니다" };

  const admin = createAdminClient();
  const { data: row, error: readErr } = await admin
    .from("academy_documents")
    .select("id, file_path, file_name")
    .eq("tenant_id", gate.user.tenantId)
    .eq("id", docId)
    .eq("staff_user_id", userId)
    .eq("kind", "file")
    .maybeSingle();
  if (readErr) return { error: humanizeDbError(readErr.message, "확인") };
  if (!row) return { error: "이미 삭제된 계약서입니다" };

  const { error, data: deleted } = await admin
    .from("academy_documents")
    .delete()
    .eq("tenant_id", gate.user.tenantId)
    .eq("id", docId)
    .select("id"); // select 없으면 0행 삭제도 성공으로 보인다
  if (error) return { error: humanizeDbError(error.message, "삭제") };
  if (!deleted?.length) return { error: "이미 삭제된 계약서입니다" };
  if (row.file_path) {
    await removeObject(row.file_path, { bucket: MEDIA_KIND.document.supabaseBucket }).catch(() => {});
  }

  await logAction({
    action: "staff_contract_file_delete",
    targetType: "user",
    metadata: { docId, fileName: row.file_name },
  });
  revalidatePath(`/staff/${userId}`);
  revalidatePath("/staff");
  return { ok: true, notice: "계약서를 삭제했습니다" };
}

/**
 * 계약서 다운로드용 signed URL — 읽기 게이트(직원관리 접근, 개인 예외 반영).
 * attachment disposition이라 탭이 안 열리고 원본 파일명으로 저장된다(documents downloadDocument 규약).
 */
export async function signStaffContractFileUrl(docId: string): Promise<{ url?: string; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canAccessTenant(user.systemRole, "staff"))) return { error: "접근 권한이 없습니다" };

  const { data: row } = await createAdminClient()
    .from("academy_documents")
    .select("file_path, file_name")
    .eq("tenant_id", user.tenantId)
    .eq("id", docId)
    .eq("kind", "file")
    .not("staff_user_id", "is", null)
    .maybeSingle();
  if (!row?.file_path) return { error: "파일을 찾을 수 없습니다" };
  try {
    const downloadName = row.file_name ?? row.file_path.split("/").pop() ?? "contract.pdf";
    return { url: await resolveTenantReadUrl(row.file_path, "document", user.tenantId, undefined, downloadName) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "다운로드 URL 생성 실패" };
  }
}
