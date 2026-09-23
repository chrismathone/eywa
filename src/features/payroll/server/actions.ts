"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { payrollTotal } from "../calc";
import { calculateMonthlyPayroll } from "./queries";
import { logAction } from "@/features/audit/server/log";
import { canManageStaff } from "@/lib/auth/role-hierarchy";
import { getTenantSettings } from "@/features/owner/server/queries";
import { isChinsanTenant } from "@/features/owner/preset";
import { isPayrollEnabled, isStaffLeavesEnabled } from "../config";

async function genericFeatureDisabled(feature: "payroll" | "staff_leaves"): Promise<boolean> {
  const settings = await getTenantSettings();
  return !isChinsanTenant(settings) && !(feature === "payroll" ? isPayrollEnabled(settings) : isStaffLeavesEnabled(settings));
}

export type SavePayrollState = { error?: string; recordId?: string } | undefined;

export async function upsertPayroll(
  _prev: SavePayrollState,
  formData: FormData,
): Promise<SavePayrollState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!canManageStaff(user.systemRole)) return { error: "급여 관리 권한이 없습니다 (master / admin / manager)" };
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

  const total = payrollTotal({ baseAmount, hourlyAmount, bonus, deduction });

  const supabase = await createClient();
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

  if (error || !data) return { error: error?.message ?? "저장 실패" };

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
  if (!canManageStaff(user.systemRole)) return { error: "급여 관리 권한이 없습니다 (master / admin / manager)" };
  if (await genericFeatureDisabled("payroll")) return { error: "이 지점은 급여 기능을 사용하지 않습니다" };

  const id = String(formData.get("id") ?? "").trim();
  const userId = String(formData.get("userId") ?? "").trim();
  if (!id) return { error: "정산 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("payroll_records")
    .update({ paid_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return { error: error.message };

  if (userId) revalidatePath(`/staff/${userId}/payroll`);
  return undefined;
}

/** 자동 계산 결과를 payroll_records에 upsert (관리자가 그대로 저장하는 케이스). */
export async function autoComputePayroll(
  _prev: SavePayrollState,
  formData: FormData,
): Promise<SavePayrollState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!canManageStaff(user.systemRole)) return { error: "급여 관리 권한이 없습니다 (master / admin / manager)" };
  if (await genericFeatureDisabled("payroll")) return { error: "이 지점은 급여 기능을 사용하지 않습니다" };

  const userId = String(formData.get("userId") ?? "").trim();
  const period = String(formData.get("period") ?? "").trim();
  if (!userId || !period) return { error: "강사·정산 기간이 필요합니다" };

  const calc = await calculateMonthlyPayroll(userId, period);

  const supabase = await createClient();
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

  if (error || !data) return { error: error?.message ?? "저장 실패" };

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
  if (!canManageStaff(user.systemRole) || !(await canWriteTenant(user.systemRole, "staff"))) {
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

  revalidatePath(`/staff/${userId}/leaves`);
  return undefined;
}

export async function approveLeave(
  _prev: LeaveActionState,
  formData: FormData,
): Promise<LeaveActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };

  if (!canManageStaff(user.systemRole) || !(await canWriteTenant(user.systemRole, "staff"))) {
    return { error: "휴가 관리 권한이 없습니다 (master / admin / manager)" };
  }
  if (await genericFeatureDisabled("staff_leaves")) return { error: "이 지점은 기존 휴가 기능을 사용하지 않습니다" };

  const id = String(formData.get("id") ?? "").trim();
  const userId = String(formData.get("userId") ?? "").trim();
  if (!id) return { error: "휴가 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("staff_leaves")
    .update({ approved_by: user.id, approved_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return { error: error.message };

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

  if (!canManageStaff(user.systemRole) || !(await canWriteTenant(user.systemRole, "staff"))) {
    return { error: "휴가 관리 권한이 없습니다 (master / admin / manager)" };
  }
  if (await genericFeatureDisabled("staff_leaves")) return { error: "이 지점은 기존 휴가 기능을 사용하지 않습니다" };

  const id = String(formData.get("id") ?? "").trim();
  const userId = String(formData.get("userId") ?? "").trim();
  if (!id) return { error: "휴가 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { error } = await supabase.from("staff_leaves").delete().eq("id", id);

  if (error) return { error: error.message };

  if (userId) revalidatePath(`/staff/${userId}/leaves`);
  return undefined;
}
