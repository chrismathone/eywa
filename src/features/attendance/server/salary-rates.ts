import "server-only";
import { getTenantSettings } from "@/features/owner/server/queries";
import { isModuleEnabled } from "@/lib/modules";
import { requireAccess } from "@/lib/auth/require-access";
import { canManageTenant, canAccessTenant } from "@/lib/auth/perm-matrix";
import { isReadonlyTeacherView } from "@/lib/auth/view-as";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseGroupRates } from "@/features/payroll/salary-group";
import { ATTENDANCE_RATE_LEVELS, emptyAttendanceRates, parseAttendanceRates } from "../salary-rates";

export async function requireAttendanceSalaryAdmin(write = true) {
  const user = await requireAccess("attendance");
  // 급여 기능(모듈)이 꺼진 학원엔 급여 화면·단가·명세서가 없다 — 총괄도 예외 없음(기능이 없는 학원, 2026-09-30).
  if (!isModuleEnabled((await getTenantSettings()).modules.disabled, "payroll")) return null;
  if (await isReadonlyTeacherView()
    || !(await (write ? canManageTenant : canAccessTenant)(user.systemRole, "attendance_salary_settings"))) return null;
  return user;
}

/**
 * 강사 한 명의 **출석부 실급여 비율**(권한 판정 없음) — 출석부 화면과 프리랜서 명세서가 같은 값을 읽는다.
 *
 * 🔴 **게이트를 지난 호출부만** 부른다 — 화면은 `getAttendanceSalaryRates`(급여 설정 권한), 명세서는 명세서 열람 명단
 *    (`canViewPayslipNow`). admin 클라이언트로 읽으므로 `tenant_id`를 명시 필터한다([[#104]]).
 * · 프리랜서가 아니면 null(실급여 열·비율은 프리랜서에게만 있다).
 * · 저장된 비율표가 없으면 계약 비율(`commission_rates` — 학년별 = 초등·중등·고등, 특강 = 특강)에서 채운다.
 * · `opts.screen` — 출석부 화면 전용. 강사 정보 조회 실패를 null(실급여 열 없음)로 접는다. **명세서는 넘기지 않는다**(기본 = 던진다).
 */
export async function loadAttendanceSalaryRates(tenantId: string, teacherId: string, opts: { screen?: boolean } = {}) {
  const db = createAdminClient();
  const { data: teacher, error } = await db.from("users").select("employment_type, commission_rates, commission_rate")
    .eq("tenant_id", tenantId).eq("id", teacherId).maybeSingle();
  // 🔴 조회 실패를 "프리랜서 아님"(null)으로 접지 않는다 — 명세서가 null을 받으면 종전 티어 정산으로 떨어져 다른 식의 금액이 나온다.
  if (error) {
    console.error("[attendance-salary-rates] 강사 정보 조회 실패", teacherId, error.message);
    if (opts.screen) return null;
    throw new Error("강사 정보를 불러오지 못했습니다 — 잠시 후 다시 시도해 주세요");
  }
  if (teacher?.employment_type !== "프리랜서") return null;
  const { data: saved, error: ratesError } = await db.from("attendance_salary_rates").select("rates, updated_at")
    .eq("tenant_id", tenantId).eq("teacher_id", teacherId).maybeSingle();
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
  return { rates, updatedAt: saved?.updated_at as string | undefined };
}

/** No rates or salary data are serialized into a teacher's response. */
export async function getAttendanceSalaryRates(teacherId: string | null) {
  if (!teacherId) return null;
  const user = await requireAttendanceSalaryAdmin(false);
  if (!user) return null;
  // 🔴 화면은 강사 정보 조회 실패를 접는다(`screen`) — 그대로 던지면 일시 오류 한 번에 출석부가 통째로 오류 화면이 된다.
  //    실급여 열만 비우고 격자는 살린다(종전 동작).
  const loaded = await loadAttendanceSalaryRates(user.tenantId, teacherId, { screen: true });
  if (!loaded) return null;
  return { teacherId, rates: loaded.rates, updatedAt: loaded.updatedAt, canEdit: await canManageTenant(user.systemRole, "attendance_salary_settings") };
}
