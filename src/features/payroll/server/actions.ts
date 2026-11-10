"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { humanizeDbError } from "@/lib/supabase/db-error";
import { payrollTotal } from "../calc";
import { calculateMonthlyPayroll, PayrollInputError } from "./queries";
import { logAction } from "@/features/audit/server/log";
import { canManageStaff } from "@/lib/auth/role-hierarchy";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import { getTenantSettings } from "@/features/owner/server/queries";
import { isChinsanTenant } from "@/features/owner/preset";
import { isPayrollEnabled, isStaffLeavesEnabled } from "../config";

async function genericFeatureDisabled(feature: "payroll" | "staff_leaves"): Promise<boolean> {
  const settings = await getTenantSettings();
  // 🔴 급여는 침산도 스위치를 본다(PAYROLL_ENABLED=false 동결) — 화면(/staff/payroll·/staff/[id]/payroll)이
  //    isPayrollEnabled로 닫혀 있어도 액션을 직접 부르면 돌던 구멍(감사 S5). 휴가는 종전대로(침산 = 옛 기록 열람 유지).
  if (feature === "payroll") return !isPayrollEnabled(settings);
  return !isChinsanTenant(settings) && !isStaffLeavesEnabled(settings);
}

/**
 * 급여 쓰기 대상 확인 — 대상 직원이 **내 지점** 사람인지 admin으로 확인한다.
 * payroll_records 쓰기는 admin 클라이언트(아래)라 RLS가 테넌트를 막아 주지 않는다 → 여기서 막는다.
 */
async function assertStaffInTenant(tenantId: string, userId: string): Promise<boolean> {
  const { data } = await createAdminClient()
    .from("users")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("id", userId)
    .maybeSingle();
  return !!data;
}

export type SavePayrollState = { error?: string; recordId?: string } | undefined;

export async function upsertPayroll(
  _prev: SavePayrollState,
  formData: FormData,
): Promise<SavePayrollState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await isCurrentUserSuperAdmin()) && (!canManageStaff(user.systemRole) || !(await canWriteTenant(user.systemRole, "staff")))) {
    return { error: "급여 관리 권한이 없습니다 (master / admin / manager)" };
  }
  if (await genericFeatureDisabled("payroll")) return { error: "이 지점은 급여 기능을 사용하지 않습니다" };

  const userId = String(formData.get("userId") ?? "").trim();
  const period = String(formData.get("period") ?? "").trim();
  const baseAmount = Number(formData.get("baseAmount") ?? 0);
  const hoursWorked = Number(formData.get("hoursWorked") ?? 0);
  const hourlyAmount = Number(formData.get("hourlyAmount") ?? 0);
  const bonus = Number(formData.get("bonus") ?? 0);
  const deduction = Number(formData.get("deduction") ?? 0);
  const notes = String(formData.get("notes") ?? "").trim() || null;

  if (!userId || !period) return { error: "강사·정산 기간이 필요합니다" };
  if (!(await assertStaffInTenant(user.tenantId, userId))) return { error: "직원을 찾을 수 없습니다" };

  const total = payrollTotal({ baseAmount, hourlyAmount, bonus, deduction });

  // 🔴 admin + 명시 tenant_id — 0290a(master 전용 RLS) 적용 뒤에도 게이트를 통과한 admin·manager가 쓸 수 있게.
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("payroll_records")
    .upsert(
      {
        tenant_id: user.tenantId,
        user_id: userId,
        period,
        base_amount: baseAmount,
        hours_worked: hoursWorked,
        hourly_amount: hourlyAmount,
        bonus,
        deduction,
        total,
        notes,
      },
      { onConflict: "tenant_id,user_id,period" },
    )
    .select("id")
    .single();

  if (error || !data) return { error: error ? humanizeDbError(error.message) : "저장 실패" };

  await logAction({
    action: "payroll_upsert",
    targetType: "payroll",
    targetLabel: period,
    metadata: { userId, total },
  });
  revalidatePath(`/staff/${userId}/payroll`);
  return { recordId: data.id };
}

export type MarkPaidState = { error?: string } | undefined;

export async function markPayrollPaid(
  _prev: MarkPaidState,
  formData: FormData,
): Promise<MarkPaidState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await isCurrentUserSuperAdmin()) && (!canManageStaff(user.systemRole) || !(await canWriteTenant(user.systemRole, "staff")))) {
    return { error: "급여 관리 권한이 없습니다 (master / admin / manager)" };
  }
  if (await genericFeatureDisabled("payroll")) return { error: "이 지점은 급여 기능을 사용하지 않습니다" };

  const id = String(formData.get("id") ?? "").trim();
  const userId = String(formData.get("userId") ?? "").trim();
  if (!id) return { error: "정산 ID가 누락되었습니다" };

  const supabase = createAdminClient();
  const { data: updated, error } = await supabase
    .from("payroll_records")
    .update({ paid_at: new Date().toISOString() })
    .eq("tenant_id", user.tenantId)
    .eq("id", id)
    // 이미 지급 처리된 행은 다시 찍지 않는다(더블클릭·옛 탭 — 최초 지급 시각을 덮고 감사로그가 두 번 남던 것).
    .is("paid_at", null)
    .select("id, user_id, period, total")
    .maybeSingle();

  if (error) return { error: humanizeDbError(error.message) };
  if (!updated) return { error: "정산 기록이 없거나 이미 지급 완료로 처리되었습니다" };

  await logAction({
    action: "payroll_mark_paid",
    targetType: "payroll",
    targetLabel: updated.period,
    metadata: { userId: updated.user_id, total: Number(updated.total) },
  });
  revalidatePath(`/staff/${updated.user_id}/payroll`);
  if (userId && userId !== updated.user_id) revalidatePath(`/staff/${userId}/payroll`);
  return undefined;
}

/** 자동 계산 결과를 payroll_records에 upsert (관리자가 그대로 저장하는 케이스). */
export async function autoComputePayroll(
  _prev: SavePayrollState,
  formData: FormData,
): Promise<SavePayrollState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await isCurrentUserSuperAdmin()) && (!canManageStaff(user.systemRole) || !(await canWriteTenant(user.systemRole, "staff")))) {
    return { error: "급여 관리 권한이 없습니다 (master / admin / manager)" };
  }
  if (await genericFeatureDisabled("payroll")) return { error: "이 지점은 급여 기능을 사용하지 않습니다" };

  const userId = String(formData.get("userId") ?? "").trim();
  const period = String(formData.get("period") ?? "").trim();
  if (!userId || !period) return { error: "강사·정산 기간이 필요합니다" };
  if (!(await assertStaffInTenant(user.tenantId, userId))) return { error: "직원을 찾을 수 없습니다" };

  // 재료(단가·담당 반·시간표·출결)를 못 읽으면 저장하지 않는다 — 예전엔 0원으로 계산한 값을 그대로 저장했다(수정 계획 P1-M).
  let calc: Awaited<ReturnType<typeof calculateMonthlyPayroll>>;
  try {
    calc = await calculateMonthlyPayroll(userId, period);
  } catch (err) {
    if (err instanceof PayrollInputError) {
      console.error("[payroll] 자동 계산 재료 조회 실패 — 저장 안 함:", err.message, err.detail);
      return { error: `${err.message}. 저장하지 않았습니다 — 잠시 뒤 다시 시도해 주세요.` };
    }
    throw err;
  }

  const supabase = createAdminClient();
  const total = payrollTotal({ baseAmount: calc.baseAmount, hourlyAmount: calc.hourlyAmount });

  const { data, error } = await supabase
    .from("payroll_records")
    .upsert(
      {
        tenant_id: user.tenantId,
        user_id: userId,
        period,
        base_amount: calc.baseAmount,
        hours_worked: calc.hoursWorked,
        hourly_amount: calc.hourlyAmount,
        total,
      },
      { onConflict: "tenant_id,user_id,period" },
    )
    .select("id")
    .single();

  if (error || !data) return { error: error ? humanizeDbError(error.message) : "저장 실패" };

  await logAction({
    action: "payroll_auto_compute",
    targetType: "payroll",
    targetLabel: period,
    metadata: { userId, total, hoursWorked: calc.hoursWorked },
  });
  revalidatePath(`/staff/${userId}/payroll`);
  return { recordId: data.id };
}

// ────────────────────── 휴가 ──────────────────────

export type LeaveActionState = { error?: string } | undefined;

const LEAVE_TYPES = ["연차", "반차", "병가", "경조사", "기타"];

export async function requestLeave(
  _prev: LeaveActionState,
  formData: FormData,
): Promise<LeaveActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await isCurrentUserSuperAdmin()) && (!canManageStaff(user.systemRole) || !(await canWriteTenant(user.systemRole, "staff")))) {
    return { error: "휴가 관리 권한이 없습니다 (master / admin / manager)" };
  }
  if (await genericFeatureDisabled("staff_leaves")) return { error: "이 지점은 기존 휴가 기능을 사용하지 않습니다" };

  const userId = String(formData.get("userId") ?? "").trim();
  const leaveType = String(formData.get("leaveType") ?? "").trim();
  const startsOn = String(formData.get("startsOn") ?? "").trim();
  const endsOn = String(formData.get("endsOn") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim() || null;

  if (!userId) return { error: "강사를 선택해주세요" };
  if (!LEAVE_TYPES.includes(leaveType)) return { error: "유효한 휴가 유형이 아닙니다" };
  if (!startsOn || !endsOn) return { error: "기간을 입력해주세요" };
  if (startsOn > endsOn) return { error: "시작일이 종료일보다 빠르야 합니다" };

  const supabase = await createClient();
  const { error } = await supabase.from("staff_leaves").insert({
    tenant_id: user.tenantId,
    user_id: userId,
    leave_type: leaveType,
    starts_on: startsOn,
    ends_on: endsOn,
    reason,
  });

  if (error) return { error: error.message };

  // 사유(자유 글)는 담지 않는다 — 누구의 어떤 휴가를 언제로 넣었는지만.
  await logAction({
    action: "staff_leave_request",
    targetType: "staff_leave",
    targetLabel: `${startsOn} ~ ${endsOn}`,
    metadata: { userId, leaveType, startsOn, endsOn },
  });
  revalidatePath(`/staff/${userId}/leaves`);
  return undefined;
}

export async function approveLeave(
  _prev: LeaveActionState,
  formData: FormData,
): Promise<LeaveActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };

  if (!(await isCurrentUserSuperAdmin()) && (!canManageStaff(user.systemRole) || !(await canWriteTenant(user.systemRole, "staff")))) {
    return { error: "휴가 관리 권한이 없습니다 (master / admin / manager)" };
  }
  if (await genericFeatureDisabled("staff_leaves")) return { error: "이 지점은 기존 휴가 기능을 사용하지 않습니다" };

  const id = String(formData.get("id") ?? "").trim();
  const userId = String(formData.get("userId") ?? "").trim();
  if (!id) return { error: "휴가 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { data: approved, error } = await supabase
    .from("staff_leaves")
    .update({ approved_by: user.id, approved_at: new Date().toISOString() })
    .eq("id", id)
    .select("user_id, leave_type, starts_on, ends_on"); // 감사로그 대상(폼의 userId는 클라 값이라 믿지 않는다)

  if (error) return { error: error.message };

  const row = approved?.[0];
  if (row) {
    await logAction({
      action: "staff_leave_approve",
      targetType: "staff_leave",
      targetLabel: `${row.starts_on} ~ ${row.ends_on}`,
      metadata: {
        leaveId: id,
        userId: row.user_id,
        leaveType: row.leave_type,
        startsOn: row.starts_on,
        endsOn: row.ends_on,
      },
    });
  }
  if (userId) revalidatePath(`/staff/${userId}/leaves`);
  revalidatePath("/staff/leaves");
  return undefined;
}

export async function deleteLeave(
  _prev: LeaveActionState,
  formData: FormData,
): Promise<LeaveActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };

  if (!(await isCurrentUserSuperAdmin()) && (!canManageStaff(user.systemRole) || !(await canWriteTenant(user.systemRole, "staff")))) {
    return { error: "휴가 관리 권한이 없습니다 (master / admin / manager)" };
  }
  if (await genericFeatureDisabled("staff_leaves")) return { error: "이 지점은 기존 휴가 기능을 사용하지 않습니다" };

  const id = String(formData.get("id") ?? "").trim();
  const userId = String(formData.get("userId") ?? "").trim();
  if (!id) return { error: "휴가 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { data: removed, error } = await supabase
    .from("staff_leaves")
    .delete()
    .eq("id", id)
    .select("user_id, leave_type, starts_on, ends_on"); // 지운 뒤엔 되짚을 원본이 없다 — 누구의 언제 휴가였는지 남긴다.

  if (error) return { error: error.message };

  const row = removed?.[0];
  if (row) {
    await logAction({
      action: "staff_leave_delete",
      targetType: "staff_leave",
      targetLabel: `${row.starts_on} ~ ${row.ends_on}`,
      metadata: {
        leaveId: id,
        userId: row.user_id,
        leaveType: row.leave_type,
        startsOn: row.starts_on,
        endsOn: row.ends_on,
      },
    });
  }
  if (userId) revalidatePath(`/staff/${userId}/leaves`);
  return undefined;
}
