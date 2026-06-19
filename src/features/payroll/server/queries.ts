import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged } from "@/lib/supabase/batch";
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

/** 강사의 월별 자동 정산 계산 (attendance × hourly_rate + monthly_base). */
export async function calculateMonthlyPayroll(
  userId: string,
  period: string, // 'YYYY-MM'
): Promise<PayrollCalcResult> {
  const supabase = await createClient();

  const { data: user } = await supabase
    .from("users")
    .select("hourly_rate, monthly_base")
    .eq("id", userId)
    .single();

  const hourlyRate = Number(user?.hourly_rate ?? 0);
  const monthlyBase = Number(user?.monthly_base ?? 0);

  // 강사가 담임인 반들의 출석 기록 (해당 월)
  const start = `${period}-01`;
  // 다음 달 1일
  const [y, m] = period.split("-").map(Number);
  const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;

  const { data: classes } = await supabase
    .from("classes")
    .select("id")
    .eq("teacher_id", userId);

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
  const attendances = await fetchAllPaged<{
    session_date: string;
    status: string;
    class: { id?: string } | { id?: string }[] | null;
  }>((from, to) =>
    supabase
      .from("attendance_records")
      .select(
        `session_date, status, class:class_id ( id ), schedule:class_id ( class_schedules ( start_time, end_time ) )`,
      )
      .in("class_id", classIds)
      .gte("session_date", start)
      .lt("session_date", nextMonth)
      .in("status", ["present", "late"])
      .range(from, to),
  );

  // schedule 시간 → 반별 평균 세션 시간 → 고유 출석 세션 합 → 금액. 계산은 전부 순수 calc(#Q1).
  const { data: schedules } = await supabase
    .from("class_schedules")
    .select("class_id, start_time, end_time")
    .in("class_id", classIds);

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

export async function getPayrollHistory(userId: string): Promise<PayrollRecord[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("payroll_records")
    .select(
      "id, user_id, period, base_amount, hours_worked, hourly_amount, bonus, deduction, total, paid_at, notes",
    )
    .eq("user_id", userId)
    .order("period", { ascending: false });

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
 * 한 달 전 직원 급여를 한 표로. 저장된 payroll_records는 그대로, 미작성 직원만 calculateMonthlyPayroll로
 * 자동 추정(병렬). 데모 규모(직원 ~수십)라 per-staff 계산 허용(최적화는 후속).
 */
export async function getMonthlyPayrollOverview(period: string): Promise<PayrollOverview> {
  const supabase = await createClient();

  const { data: staff } = await supabase
    .from("users")
    .select("id, display_name, system_role, monthly_base")
    .neq("status", "inactive")
    .order("system_role", { ascending: true })
    .order("display_name", { ascending: true });
  const staffList = staff ?? [];

  const { data: records } = await supabase
    .from("payroll_records")
    .select("user_id, base_amount, hours_worked, hourly_amount, bonus, deduction, total, paid_at")
    .eq("period", period);
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
