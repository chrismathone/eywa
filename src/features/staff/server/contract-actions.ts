"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { canSeeStaffMember, STAFF_SCOPE_DENIED_MSG } from "./subject-scope";
import { createAdminClient } from "@/lib/supabase/admin";
import { humanizeDbError } from "@/lib/supabase/db-error";
import { logAction } from "@/features/audit/server/log";

// 계약 연장·기입(원장 지시 2026-07-29) — 직원 상세 '계약현황'의 유일한 쓰기 경로.
// 쓰기 자격 = 직원관리 메뉴 쓰기 권한(개인 예외 포함, 2026-08-01) — 게이트 통과 후 admin client로 조회·기입.
// (staff_contracts 읽기 RLS는 auth_menu_access를 보는데 개인 예외를 아는 0170a가 보류 중 — authenticated로
// 읽으면 개인 허용 admin의 차수 계산이 빈 결과가 돼 차수가 꼬인다. admin 경로는 tenant_id 필터 필수.)

export type ContractActionState = { ok?: true; error?: string; notice?: string } | undefined;

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** 계약 연장 — 새 차수 한 건을 기입한다. 차수는 서버가 정한다(폼에서 받으면 중복·역행이 들어온다). */
export async function extendStaffContract(
  _prev: ContractActionState,
  formData: FormData,
): Promise<ContractActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(actor.systemRole, "staff"))) return { error: "계약을 변경할 권한이 없습니다" };

  const userId = String(formData.get("userId") ?? "").trim();
  if (userId && !(await canSeeStaffMember(actor, userId))) return { error: STAFF_SCOPE_DENIED_MSG };
  const startDate = String(formData.get("startDate") ?? "").trim();
  const endDate = String(formData.get("endDate") ?? "").trim();
  const terms = String(formData.get("terms") ?? "").trim();
  const memo = String(formData.get("memo") ?? "").trim();

  if (!userId) return { error: "직원을 찾을 수 없습니다" };
  if (!YMD.test(startDate) || !YMD.test(endDate)) return { error: "계약 기간을 모두 입력하세요" };
  if (endDate <= startDate) return { error: "종료일은 시작일보다 뒤여야 합니다" };

  const supabase = createAdminClient();
  // 대상이 우리 학원 직원인지 재확인(폼 변조 차단) — admin client라 RLS가 없으니 tenant 대조가 격리의 전부.
  const { data: target, error: targetErr } = await supabase
    .from("users")
    .select("id, display_name, tenant_id")
    .eq("id", userId)
    .maybeSingle();
  if (targetErr) return { error: humanizeDbError(targetErr.message, "확인"), };
  if (!target || target.tenant_id !== actor.tenantId) return { error: "직원을 찾을 수 없습니다" };

  // 다음 차수 = 현재 최대 + 1. 계약이 하나도 없으면 1차부터.
  // 차수는 **계약(kind='contract')만** 센다 — note는 전부 seq=0이라 섞이면 다음 차수가 1로 되돌아간다.
  const { data: last, error: lastErr } = await supabase
    .from("staff_contracts")
    .select("seq")
    .eq("tenant_id", actor.tenantId)
    .eq("user_id", userId)
    .eq("kind", "contract")
    .order("seq", { ascending: false })
    .limit(1);
  if (lastErr) return { error: humanizeDbError(lastErr.message, "확인") };
  const seq = ((last?.[0]?.seq as number | undefined) ?? 0) + 1;

  const { error } = await supabase.from("staff_contracts").insert({
    tenant_id: target.tenant_id,
    user_id: userId,
    seq,
    kind: "contract", // 화면에서 넣는 건 언제나 기간 있는 계약(note는 시트 이관 산물).
    start_date: startDate,
    end_date: endDate,
    terms: terms || null,
    memo: memo || null,
    created_by: actor.id,
  });
  if (error) return { error: humanizeDbError(error.message, "저장") };

  await logAction({
    action: "staff_contract_extend",
    targetType: "user",
    targetLabel: target.display_name ?? null,
    metadata: { seq, startDate, endDate },
  });
  revalidatePath(`/staff/${userId}`);
  return { ok: true, notice: `${seq}차 계약을 기입했습니다 (${startDate} ~ ${endDate})` };
}

/**
 * 계약/이력 줄 수정 — 기간·조건·메모를 고친다(원장 지시 2026-08-03: 히스토리도 수정·삭제 가능해야).
 * kind='contract'는 기간 필수(현재계약·만료 계산의 원천), kind='note'(시트 이력 줄)는 기간 없이 조건만도 됨.
 */
export async function updateStaffContract(
  _prev: ContractActionState,
  formData: FormData,
): Promise<ContractActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(actor.systemRole, "staff"))) return { error: "계약을 변경할 권한이 없습니다" };

  const userId = String(formData.get("userId") ?? "").trim();
  if (userId && !(await canSeeStaffMember(actor, userId))) return { error: STAFF_SCOPE_DENIED_MSG };
  const contractId = String(formData.get("contractId") ?? "").trim();
  const startDate = String(formData.get("startDate") ?? "").trim();
  const endDate = String(formData.get("endDate") ?? "").trim();
  const terms = String(formData.get("terms") ?? "").trim();
  const memo = String(formData.get("memo") ?? "").trim();
  if (!userId || !contractId) return { error: "수정할 계약을 찾을 수 없습니다" };

  const supabase = createAdminClient();
  const { data: row, error: readErr } = await supabase
    .from("staff_contracts")
    .select("id, kind, seq")
    .eq("tenant_id", actor.tenantId)
    .eq("user_id", userId)
    .eq("id", contractId)
    .maybeSingle();
  if (readErr) return { error: humanizeDbError(readErr.message, "확인") };
  if (!row) return { error: "수정할 계약을 찾을 수 없습니다" };

  const isContract = (row.kind as string) === "contract";
  if (isContract) {
    if (!YMD.test(startDate) || !YMD.test(endDate)) return { error: "계약 기간을 모두 입력하세요" };
    if (endDate <= startDate) return { error: "종료일은 시작일보다 뒤여야 합니다" };
  } else {
    // 이력 줄 — 날짜는 선택. 적었다면 형식은 맞아야 하고, 둘 다 적었으면 순서도 맞아야.
    if (startDate && !YMD.test(startDate)) return { error: "시작일 형식이 올바르지 않습니다" };
    if (endDate && !YMD.test(endDate)) return { error: "종료일 형식이 올바르지 않습니다" };
    if (startDate && endDate && endDate <= startDate) return { error: "종료일은 시작일보다 뒤여야 합니다" };
    if (!startDate && !terms) return { error: "날짜나 조건 중 하나는 있어야 합니다" };
  }

  const { error, data: updated } = await supabase
    .from("staff_contracts")
    .update({
      start_date: startDate || null,
      end_date: endDate || null,
      terms: terms || null,
      memo: memo || null,
    })
    .eq("tenant_id", actor.tenantId)
    .eq("id", contractId)
    .select("id");
  if (error) return { error: humanizeDbError(error.message, "수정") };
  if (!updated?.length) return { error: "이미 삭제된 계약입니다" };

  await logAction({
    action: "staff_contract_update",
    targetType: "user",
    metadata: { contractId, kind: row.kind, seq: row.seq, startDate, endDate },
  });
  revalidatePath(`/staff/${userId}`);
  revalidatePath("/staff");
  return { ok: true, notice: "계약 내용을 수정했습니다" };
}

/**
 * 계약/이력 줄 삭제 — 어느 줄이든 지운다(원장 지시 2026-08-03, 종전 "마지막 차수만" 제한 해제).
 * 중간 차수를 지우면 차수에 빈 번호가 남지만 그대로 둔다 — 차수는 시트에서 온 역사적 사실이라
 * 재번호를 매기면 오히려 원문과 어긋난다(현재계약 판정은 최대 차수라 영향 없음).
 */
export async function deleteStaffContract(
  _prev: ContractActionState,
  formData: FormData,
): Promise<ContractActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(actor.systemRole, "staff"))) return { error: "계약을 변경할 권한이 없습니다" };

  const userId = String(formData.get("userId") ?? "").trim();
  const contractId = String(formData.get("contractId") ?? "").trim();
  if (!userId || !contractId) return { error: "삭제할 계약을 찾을 수 없습니다" };
  if (!(await canSeeStaffMember(actor, userId))) return { error: STAFF_SCOPE_DENIED_MSG };

  const supabase = createAdminClient();
  const { data: row, error: readErr } = await supabase
    .from("staff_contracts")
    .select("id, kind, seq")
    .eq("tenant_id", actor.tenantId)
    .eq("user_id", userId)
    .eq("id", contractId)
    .maybeSingle();
  if (readErr) return { error: humanizeDbError(readErr.message, "확인") };
  if (!row) return { error: "이미 삭제된 계약입니다" };

  const { error, data: deleted } = await supabase
    .from("staff_contracts")
    .delete()
    .eq("tenant_id", actor.tenantId)
    .eq("id", contractId)
    .select("id"); // ⚠️ select 없으면 0행 삭제도 error:null — "지웠다"는 거짓 성공이 된다.
  if (error) return { error: humanizeDbError(error.message, "삭제") };
  if (!deleted?.length) return { error: "이미 삭제된 계약입니다" };

  await logAction({
    action: "staff_contract_delete",
    targetType: "user",
    metadata: { contractId, kind: row.kind, seq: row.seq },
  });
  revalidatePath(`/staff/${userId}`);
  revalidatePath("/staff");
  return { ok: true, notice: "삭제했습니다" };
}
