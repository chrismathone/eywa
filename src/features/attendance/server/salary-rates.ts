import "server-only";
import { getTenantSettings } from "@/features/owner/server/queries";
import { isModuleEnabled } from "@/lib/modules";
import { requireAccess } from "@/lib/auth/require-access";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canManageTenant, canAccessTenant } from "@/lib/auth/perm-matrix";
import { isReadonlyTeacherView } from "@/lib/auth/view-as";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseGroupRates } from "@/features/payroll/salary-group";
import { ATTENDANCE_RATE_LEVELS, emptyAttendanceRates, parseAttendanceRates, type AttendanceSalaryRates } from "../salary-rates";
import { loadSalarySheetVisible } from "./salary-visibility";

export async function requireAttendanceSalaryAdmin(write = true) {
  const user = await requireAccess("attendance");
  // 급여 기능(모듈)이 꺼진 학원엔 급여 화면·단가·명세서가 없다 — 총괄도 예외 없음(기능이 없는 학원, 2026-09-30).
  if (!isModuleEnabled((await getTenantSettings()).modules.disabled, "payroll")) return null;
  if (await isReadonlyTeacherView()
    || !(await (write ? canManageTenant : canAccessTenant)(user.systemRole, "attendance_salary_settings"))) return null;
  return user;
}

/**
 * 위와 **같은 문을 이동 없이** 본다 — 출석부 페이지 밖(회차 확정의 JJ실 줄 · 그 서버 액션)에서 쓴다.
 * 🔴 `requireAccess("attendance")`는 출석부 메뉴가 닫힌 계정을 홈으로 **보낸다**(redirect). 수납은 열려 있고 출석부는 닫힌 계정
 *    (상담 역할에 수납만 열어 준 경우 등)이 회차 확정을 열면 이 판정 하나 때문에 화면이 통째로 이동한다(적대 리뷰 2026-10-07).
 *    여기는 판정만 하고 null을 돌려준다 — 줄을 안 세우거나 액션이 `{ ok: false }`를 돌려주면 된다.
 */
export async function attendanceSalaryAdminOrNull(write = true) {
  const user = await getCurrentUser();
  if (!user) return null;
  if (!(await canAccessTenant(user.systemRole, "attendance"))) return null;
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

/** 월별 출석부가 받는 실급여 재료 — 누가 보는 화면인지(`manage`)와 표에 실을지(`visible`)를 함께 싣는다. */
export type AttendanceSalarySheet = {
  teacherId: string;
  rates: AttendanceSalaryRates;
  updatedAt?: string;
  /** 급여 비율 설정 권한자의 관리자 화면인가 — 비율 설정·'합계 및 실급여 보여주기' 버튼이 서는 화면. 선생님 본인 화면은 false. */
  manage: boolean;
  canEdit: boolean;
  /** 그 달의 '합계 및 실급여 보여주기'가 켜져 있는가(선생님 × 달, 0352a·0353a) — 켜져 있을 때만 표에 실급여 값을 싣는다. */
  visible: boolean;
};

/**
 * 월별 출석부(강사 전체 보기)의 실급여 재료 — 문은 둘이다(원장 2026-10-07 *"권한자가 … 실급여 보이기 토글을 on하면
 * 실제 강사뷰의 강사가 출석부에서 합계 및 실급여를 볼 수 있게"*).
 *
 * 스위치는 **달마다 따로**다(원장 2026-10-07 *"9월에 보여주기 눌렀다고해서 10월에 보여주는건 아님"*) — `month` = 출석부가 보는 달.
 *
 * ① **관리자 화면**(급여 비율 설정 권한) — 비율은 늘 받는다(비율 설정 창의 재료). 표에 싣는 것은 `visible`일 때만.
 * ② **선생님 본인 화면**(강사 화면의 주인 = 이 선생님) — 그 선생님의 스위치가 **켜져 있을 때만** 받는다.
 *    꺼져 있으면 비율·급여 값을 읽지도 싣지도 않는다(화면에서 감추는 게 아니다).
 *    · '다른 강사 뷰'(열람 전용)는 그 선생님이 보는 그대로 보되, **급여 비율 설정 권한이 있는 사람만** — 뷰 자격만으로 남의 급여가 열리지 않게.
 * 🔴 ②는 선생님이 매일 여는 화면이다 — 조회가 실패해도 던지지 않는다(실급여 열만 비우고 출석부는 산다, [[#95]]).
 */
export async function getAttendanceSalaryRates(teacherId: string | null, month: string): Promise<AttendanceSalarySheet | null> {
  if (!teacherId) return null;
  const admin = await requireAttendanceSalaryAdmin(false);
  if (admin) {
    // 🔴 화면은 강사 정보 조회 실패를 접는다(`screen`) — 그대로 던지면 일시 오류 한 번에 출석부가 통째로 오류 화면이 된다.
    //    실급여 열만 비우고 격자는 살린다(종전 동작).
    const [loaded, visible, canEdit] = await Promise.all([
      loadAttendanceSalaryRates(admin.tenantId, teacherId, { screen: true }),
      loadSalarySheetVisible(admin.tenantId, teacherId, month),
      canManageTenant(admin.systemRole, "attendance_salary_settings"),
    ]);
    if (!loaded) return null;
    return { teacherId, rates: loaded.rates, updatedAt: loaded.updatedAt, manage: true, canEdit, visible };
  }
  const user = await requireAccess("attendance");
  if ((await effectiveTeacherId()) !== teacherId) return null;
  if (!isModuleEnabled((await getTenantSettings()).modules.disabled, "payroll")) return null;
  if (user.id !== teacherId && !(await canAccessTenant(user.systemRole, "attendance_salary_settings"))) return null;
  if (!(await loadSalarySheetVisible(user.tenantId, teacherId, month))) return null;
  try {
    const loaded = await loadAttendanceSalaryRates(user.tenantId, teacherId, { screen: true });
    if (!loaded) return null;
    return { teacherId, rates: loaded.rates, updatedAt: loaded.updatedAt, manage: false, canEdit: false, visible: true };
  } catch (error) {
    console.error("[attendance-salary-rates] 선생님 화면 실급여 재료 조회 실패", teacherId, error instanceof Error ? error.message : error);
    return null;
  }
}
