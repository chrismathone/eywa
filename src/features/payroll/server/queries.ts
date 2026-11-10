import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { canManageStaff } from "@/lib/auth/role-hierarchy";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import {
  aggregateClassHours,
  computePayrollAmounts,
  sumSessionHours,
  summarizePayrollRows,
  type PayrollStatus,
} from "../calc";

export type PayrollRecord = {
  id: string;
  userId: string;
  period: string;
  baseAmount: number;
  hoursWorked: number;
  hourlyAmount: number;
  bonus: number;
  deduction: number;
  total: number;
  paidAt: string | null;
  notes: string | null;
};

export type PayrollCalcResult = {
  period: string;
  baseAmount: number;
  hoursWorked: number;
  hourlyAmount: number;
  classCount: number;
};

/**
 * 자동 정산 재료(단가·담당 반·시간표·출결)를 읽지 못했다 — 0원으로 계산하지 않고 이걸 던진다.
 * 예전엔 조회 오류를 버려 단가 0·반 0개·시간 0으로 계산했고, 자동 계산 저장이 그 값을 그대로 급여 기록에 썼다(수정 계획 P1-M).
 */
export class PayrollInputError extends Error {
  /** 진단용 원문(오류 코드·DB 메시지) — 화면에 내지 않는다(raw 원문 노출 금지). 로그로만. */
  readonly detail: string | undefined;
  /** @param what 조사까지 붙인 대상(예: "직원 단가를") */
  constructor(what: string, detail?: string) {
    super(`급여 자동 계산에 필요한 ${what} 읽지 못했습니다`);
    this.name = "PayrollInputError";
    this.detail = detail;
  }
}

/** 강사의 월별 자동 정산 계산 (attendance × hourly_rate + monthly_base). 재료를 못 읽으면 `PayrollInputError`. */
export async function calculateMonthlyPayroll(
  userId: string,
  period: string, // 'YYYY-MM'
): Promise<PayrollCalcResult> {
  const supabase = await createClient();

  const { data: user, error: userError } = await supabase
    .from("users")
    .select("hourly_rate, monthly_base")
    .eq("id", userId)
    .maybeSingle();
  if (userError || !user) throw new PayrollInputError("직원 단가를", userError?.code ?? "직원 없음");

  const hourlyRate = Number(user.hourly_rate ?? 0);
  const monthlyBase = Number(user.monthly_base ?? 0);

  // 강사가 담임인 반들의 출석 기록 (해당 월)
  const start = `${period}-01`;
  // 다음 달 1일
  const [y, m] = period.split("-").map(Number);
  const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;

  const { data: classes, error: classesError } = await supabase
    .from("classes")
    .select("id")
    .eq("teacher_id", userId);
  if (classesError) throw new PayrollInputError("담당 반을", classesError.code);

  const classIds = (classes ?? []).map((c) => c.id);
  if (classIds.length === 0) {
    return {
      period,
      baseAmount: monthlyBase,
      hoursWorked: 0,
      hourlyAmount: 0,
      classCount: 0,
    };
  }

  // 해당 월 attendance_records 중 강사 담당 반 + present/late만 시간 합산.
  // fetchAllPaged — 활동 많은 강사(반 5+개)는 월 출석이 1000행을 넘을 수 있어 전건 fetch면 잘리고(#54),
  // 잘린 채 시간 합산하면 급여가 과소 지급된다(돈 정확성). range 페이지네이션으로 전건 확보.
  type AttendanceRow = { session_date: string; status: string; class: { id?: string } | { id?: string }[] | null };
  let attendances: AttendanceRow[];
  try {
    attendances = await fetchAllPaged<AttendanceRow>((from, to) =>
      supabase
        .from("attendance_records")
        .select(`session_date, status, class:class_id ( id )`)
        .in("class_id", classIds)
        .gte("session_date", start)
        .lt("session_date", nextMonth)
        .in("status", ["present", "late"])
        // 페이지를 넘길 때 행이 겹치거나 빠지지 않게 고정 순서(batch.ts 규약) — 빠지면 그만큼 급여가 적게 나온다.
        .order("id")
        .range(from, to),
    );
  } catch (err) {
    throw new PayrollInputError("출결 기록을", err instanceof Error ? err.message : String(err));
  }

  // schedule 시간 → 반별 평균 세션 시간 → 고유 출석 세션 합 → 금액. 계산은 전부 순수 calc(#Q1).
  const { data: schedules, error: schedulesError } = await supabase
    .from("class_schedules")
    .select("class_id, start_time, end_time")
    .in("class_id", classIds);
  if (schedulesError) throw new PayrollInputError("수업 시간표를", schedulesError.code);

  const classHours = aggregateClassHours(
    (schedules ?? []).map((s) => ({
      class_id: s.class_id,
      start_time: String(s.start_time),
      end_time: String(s.end_time),
    })),
  );
  const sessions = (attendances ?? [])
    .map((a) => {
      const cls = (Array.isArray(a.class) ? a.class[0] : a.class) as { id?: string } | undefined;
      return cls?.id ? { classId: cls.id, date: a.session_date as string } : null;
    })
    .filter((x): x is { classId: string; date: string } => x !== null);
  const totalHours = sumSessionHours(sessions, classHours);

  return {
    period,
    ...computePayrollAmounts({ monthlyBase, hourlyRate, totalHours }),
    classCount: classIds.length,
  };
}

/**
 * payroll_records 읽기용 클라이언트 — **admin + 명시 tenant_id 필터**.
 *
 * 🔴 0290a가 이 표를 master 전용 RLS로 잠근다. 그런데 급여 화면(/staff/[id]/payroll)은 직원관리 권한이 있는
 *    admin·manager도 연다(호출부 게이트 = requireAccess("staff") + isPayrollEnabled). 세션 클라이언트로 읽으면
 *    SQL 적용 뒤 그들에게 **에러 없이 0행**이 된다([[#104]]) → 호출부 게이트를 지난 뒤 여기서 admin으로 읽는다.
 *    SQL 적용 전·후 모두 같은 결과(expand/contract, [[#95]]).
 */
async function payrollReadScope(): Promise<{ db: ReturnType<typeof createAdminClient>; tenantId: string } | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  // 🔴 admin 클라이언트는 RLS를 우회한다 — 쓰기 게이트(canManageStaff)와 **같은 역할 게이트**를 여기서 건다
  //    (적대적 리뷰: 직원관리 개인 예외를 받은 강사·회계가 동료 급여 이력을 열 수 있었다, #77). super_admin 통과.
  if (!canManageStaff(user.systemRole) && !(await isCurrentUserSuperAdmin())) return null;
  return { db: createAdminClient(), tenantId: user.tenantId };
}

export async function getPayrollHistory(userId: string): Promise<PayrollRecord[]> {
  const scope = await payrollReadScope();
  if (!scope) return [];
  const { data, error } = await scope.db
    .from("payroll_records")
    .select(
      "id, user_id, period, base_amount, hours_worked, hourly_amount, bonus, deduction, total, paid_at, notes",
    )
    .eq("tenant_id", scope.tenantId)
    .eq("user_id", userId)
    .order("period", { ascending: false });
  if (error) throw new Error("급여 기록을 불러오지 못했습니다");

  return (data ?? []).map((r) => ({
    id: r.id,
    userId: r.user_id,
    period: r.period,
    baseAmount: Number(r.base_amount),
    hoursWorked: Number(r.hours_worked),
    hourlyAmount: Number(r.hourly_amount),
    bonus: Number(r.bonus),
    deduction: Number(r.deduction),
    total: Number(r.total),
    paidAt: r.paid_at,
    notes: r.notes,
  }));
}

// === 월별 전직원 급여표 (한 화면 요약 — 검색·상태필터·합계) ===
export type PayrollOverviewRow = {
  userId: string;
  name: string;
  systemRole: string;
  baseAmount: number;
  hoursWorked: number;
  hourlyAmount: number;
  bonus: number;
  deduction: number;
  total: number;
  status: PayrollStatus; // paid 지급완료 / saved 작성됨 / draft 미작성(자동추정)
  paidAt: string | null;
};

export type PayrollOverview = {
  period: string;
  rows: PayrollOverviewRow[];
  totalBase: number;
  totalNet: number;
  paidCount: number;
  savedCount: number;
  draftCount: number;
};

/**
 * 한 달 전 직원 급여를 한 표로. 저장된 payroll_records는 그대로, 미작성 직원은 월 기본급만 표기한다
 * (출결 기반 시간 정산은 개별 화면 /staff/[id]/payroll에서 — 전 직원 동시 계산은 반응속도 원칙상 하지 않는다).
 */
export async function getMonthlyPayrollOverview(period: string): Promise<PayrollOverview> {
  const supabase = await createClient();

  const { data: staff, error: staffError } = await supabase
    .from("users")
    .select("id, display_name, system_role, monthly_base")
    .neq("status", "inactive")
    .order("system_role", { ascending: true })
    .order("display_name", { ascending: true });
  // 조회 실패를 빈 목록으로 삼키면 "직원 0명" 표가 된다 — 아래 급여 기록 조회와 같이 던진다.
  if (staffError) throw new Error("직원 목록을 불러오지 못했습니다");
  const staffList = staff ?? [];

  const scope = await payrollReadScope();
  const { data: records, error: recordsError } = scope
    ? await scope.db
        .from("payroll_records")
        .select("user_id, base_amount, hours_worked, hourly_amount, bonus, deduction, total, paid_at")
        .eq("tenant_id", scope.tenantId)
        .eq("period", period)
        .order("id")
    : { data: [], error: null };
  if (recordsError) throw new Error("급여 기록을 불러오지 못했습니다");
  const recByUser = new Map((records ?? []).map((r) => [r.user_id, r]));

  // 저장된 정산은 record가 진실. 미작성은 월기본만 표기(정확한 시급분 attendance 계산은 무거워
  // 개별 드릴인 /staff/[id]/payroll에서 — 전직원 동시 계산은 반응속도 원칙 위반이라 지양).
  const rows: PayrollOverviewRow[] = staffList.map((s) => {
    const rec = recByUser.get(s.id);
    if (rec) {
      return {
        userId: s.id,
        name: s.display_name,
        systemRole: s.system_role,
        baseAmount: Number(rec.base_amount),
        hoursWorked: Number(rec.hours_worked),
        hourlyAmount: Number(rec.hourly_amount),
        bonus: Number(rec.bonus),
        deduction: Number(rec.deduction),
        total: Number(rec.total),
        status: rec.paid_at ? "paid" : "saved",
        paidAt: rec.paid_at,
      };
    }
    const base = Number(s.monthly_base ?? 0);
    return {
      userId: s.id,
      name: s.display_name,
      systemRole: s.system_role,
      baseAmount: base,
      hoursWorked: 0,
      hourlyAmount: 0,
      bonus: 0,
      deduction: 0,
      total: base,
      status: "draft",
      paidAt: null,
    };
  });

  const summary = summarizePayrollRows(rows);
  return { period, rows, ...summary };
}

export type LeaveRow = {
  id: string;
  userId: string;
  leaveType: string;
  startsOn: string;
  endsOn: string;
  reason: string | null;
  approvedBy: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
};

export type StaffLeaveRow = LeaveRow & { staffName: string; staffRole: string | null };

/** 전 직원 휴가 — 관리자 일괄 검토용. 대기(미승인) 먼저, 그다음 최근 시작일순. */
export async function getAllStaffLeaves(): Promise<StaffLeaveRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("staff_leaves")
    .select(
      `id, user_id, leave_type, starts_on, ends_on, reason,
       approved_by, approved_at,
       approver:approved_by ( display_name ),
       staff:user_id ( display_name, job_title )`,
    )
    .order("approved_at", { ascending: true, nullsFirst: true })
    .order("starts_on", { ascending: false });

  return (data ?? []).map((r) => {
    const approver = (Array.isArray(r.approver) ? r.approver[0] : r.approver) as
      | { display_name?: string }
      | undefined;
    const staff = (Array.isArray(r.staff) ? r.staff[0] : r.staff) as
      | { display_name?: string; job_title?: string | null }
      | undefined;
    return {
      id: r.id,
      userId: r.user_id,
      leaveType: r.leave_type,
      startsOn: r.starts_on,
      endsOn: r.ends_on,
      reason: r.reason,
      approvedBy: r.approved_by,
      approvedByName: approver?.display_name ?? null,
      approvedAt: r.approved_at,
      staffName: staff?.display_name ?? "?",
      staffRole: staff?.job_title ?? null,
    };
  });
}

export async function getStaffLeaves(userId: string): Promise<LeaveRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("staff_leaves")
    .select(
      `id, user_id, leave_type, starts_on, ends_on, reason,
       approved_by, approved_at,
       approver:approved_by ( display_name )`,
    )
    .eq("user_id", userId)
    .order("starts_on", { ascending: false });

  return (data ?? []).map((r) => {
    const approver = (Array.isArray(r.approver) ? r.approver[0] : r.approver) as
      | { display_name?: string }
      | undefined;
    return {
      id: r.id,
      userId: r.user_id,
      leaveType: r.leave_type,
      startsOn: r.starts_on,
      endsOn: r.ends_on,
      reason: r.reason,
      approvedBy: r.approved_by,
      approvedByName: approver?.display_name ?? null,
      approvedAt: r.approved_at,
    };
  });
}
