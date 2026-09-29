import "server-only";
import { getTenantSettings } from "@/features/owner/server/queries";
import { isModuleEnabled } from "@/lib/modules";
import { requireAccess } from "@/lib/auth/require-access";
import { canManageTenant } from "@/lib/auth/perm-matrix";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseGroupRates } from "@/features/payroll/salary-group";
import { ATTENDANCE_RATE_LEVELS, emptyAttendanceRates, parseAttendanceRates } from "../salary-rates";

export async function requireAttendanceSalaryAdmin() {
  const user = await requireAccess("attendance");
  // 급여 기능(모듈)이 꺼진 학원엔 급여 화면·단가·명세서가 없다 — 총괄도 예외 없음(기능이 없는 학원, 2026-09-30).
  if (!isModuleEnabled((await getTenantSettings()).modules.disabled, "payroll")) return null;
  if (!["master", "admin", "manager"].includes(user.systemRole) || await effectiveTeacherId()
    || !(await canManageTenant(user.systemRole, "attendance"))) return null;
  return user;
}

/** No rates or salary data are serialized into a teacher's response. */
export async function getAttendanceSalaryRates(teacherId: string | null) {
  if (!teacherId) return null;
  const user = await requireAttendanceSalaryAdmin();
  if (!user) return null;
  const db = createAdminClient();
  const { data: teacher, error } = await db.from("users").select("employment_type, commission_rates, commission_rate")
    .eq("tenant_id", user.tenantId).eq("id", teacherId).maybeSingle();
  if (error || teacher?.employment_type !== "프리랜서") return null;
  const { data: saved, error: ratesError } = await db.from("attendance_salary_rates").select("rates, updated_at")
    .eq("tenant_id", user.tenantId).eq("teacher_id", teacherId).maybeSingle();
  if (ratesError) throw new Error(`출석부 급여 비율을 불러오지 못했습니다: ${ratesError.message}`);
  const stored = saved ? parseAttendanceRates(saved.rates) : null;
  if (saved && !stored) throw new Error("저장된 출석부 급여 비율을 확인해 주세요");
  const rates = stored ?? emptyAttendanceRates();
  if (!saved) {
    const previous = parseGroupRates(teacher.commission_rates);
    const defaultRate = teacher.commission_rate == null ? undefined : Number(teacher.commission_rate);
    for (const level of ATTENDANCE_RATE_LEVELS) {
      const regular = previous[level] ?? defaultRate;
      const special = previous["특강"] ?? defaultRate;
      if (regular !== undefined) rates.regular[level] = regular;
      if (special !== undefined) rates.special[level] = special;
    }
  }
  return { teacherId, rates, updatedAt: saved?.updated_at as string | undefined };
}
