"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canManageStaff } from "@/lib/auth/role-hierarchy";
import { createClient } from "@/lib/supabase/server";
import { humanizeDbError } from "@/lib/supabase/db-error";
import { logAction } from "@/features/audit/server/log";

// 계약 연장·기입(원장 지시 2026-07-29) — 직원 상세 '계약현황'의 유일한 쓰기 경로.
// 쓰기 자격은 사무실(master/admin/manager) — 0149a RLS와 같은 기준(화면·서버·DB 3중).

export type ContractActionState = { ok?: true; error?: string; notice?: string } | undefined;

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** 계약 연장 — 새 차수 한 건을 기입한다. 차수는 서버가 정한다(폼에서 받으면 중복·역행이 들어온다). */
export async function extendStaffContract(
  _prev: ContractActionState,
  formData: FormData,
): Promise<ContractActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { error: "로그인이 필요합니다" };
  if (!canManageStaff(actor.systemRole)) return { error: "계약을 변경할 권한이 없습니다 (원장·관리자·매니저)" };

  const userId = String(formData.get("userId") ?? "").trim();
  const startDate = String(formData.get("startDate") ?? "").trim();
  const endDate = String(formData.get("endDate") ?? "").trim();
  const terms = String(formData.get("terms") ?? "").trim();
  const memo = String(formData.get("memo") ?? "").trim();

  if (!userId) return { error: "직원을 찾을 수 없습니다" };
  if (!YMD.test(startDate) || !YMD.test(endDate)) return { error: "계약 기간을 모두 입력하세요" };
  if (endDate <= startDate) return { error: "종료일은 시작일보다 뒤여야 합니다" };

  const supabase = await createClient();
  // 대상이 우리 학원 직원인지 재확인(폼 변조 차단). RLS도 이중 방어.
  const { data: target, error: targetErr } = await supabase
    .from("users")
    .select("id, display_name, tenant_id")
    .eq("id", userId)
    .maybeSingle();
  if (targetErr) return { error: humanizeDbError(targetErr.message, "확인"), };
  if (!target) return { error: "직원을 찾을 수 없습니다" };

  // 다음 차수 = 현재 최대 + 1. 계약이 하나도 없으면 1차부터.
  const { data: last, error: lastErr } = await supabase
    .from("staff_contracts")
    .select("seq")
    .eq("user_id", userId)
    .order("seq", { ascending: false })
    .limit(1);
  if (lastErr) return { error: humanizeDbError(lastErr.message, "확인") };
  const seq = ((last?.[0]?.seq as number | undefined) ?? 0) + 1;

  const { error } = await supabase.from("staff_contracts").insert({
    tenant_id: target.tenant_id,
    user_id: userId,
    seq,
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

/** 잘못 기입한 계약 삭제 — 가장 최근 차수만 지울 수 있다(중간을 지우면 차수가 비어 이력이 어긋난다). */
export async function deleteLatestStaffContract(
  _prev: ContractActionState,
  formData: FormData,
): Promise<ContractActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { error: "로그인이 필요합니다" };
  if (!canManageStaff(actor.systemRole)) return { error: "계약을 변경할 권한이 없습니다 (원장·관리자·매니저)" };

  const userId = String(formData.get("userId") ?? "").trim();
  const contractId = String(formData.get("contractId") ?? "").trim();
  if (!userId || !contractId) return { error: "삭제할 계약을 찾을 수 없습니다" };

  const supabase = await createClient();
  const { data: rows, error: readErr } = await supabase
    .from("staff_contracts")
    .select("id, seq")
    .eq("user_id", userId)
    .order("seq", { ascending: false })
    .limit(1);
  if (readErr) return { error: humanizeDbError(readErr.message, "확인") };
  if (!rows?.length || rows[0].id !== contractId) {
    return { error: "가장 마지막 차수만 삭제할 수 있습니다" };
  }

  const { error, data: deleted } = await supabase
    .from("staff_contracts")
    .delete()
    .eq("id", contractId)
    .select("id"); // ⚠️ select 없으면 0행 삭제도 error:null — "지웠다"는 거짓 성공이 된다.
  if (error) return { error: humanizeDbError(error.message, "삭제") };
  if (!deleted?.length) return { error: "이미 삭제된 계약입니다" };

  await logAction({
    action: "staff_contract_delete",
    targetType: "user",
    metadata: { contractId, seq: rows[0].seq },
  });
  revalidatePath(`/staff/${userId}`);
  return { ok: true, notice: "마지막 차수 계약을 삭제했습니다" };
}
