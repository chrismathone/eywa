import "server-only";
import { createClient } from "@/lib/supabase/server";

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

  // 해당 월 attendance_records 중 강사 담당 반 + present/late만 시간 합산
  const { data: attendances } = await supabase
    .from("attendance_records")
    .select(
      `session_date, status, class:class_id ( id ), schedule:class_id ( class_schedules ( start_time, end_time ) )`,
    )
    .in("class_id", classIds)
    .gte("session_date", start)
    .lt("session_date", nextMonth)
    .in("status", ["present", "late"]);

  // 출석 1건 = 1세션 = class_schedule 의 (end - start) 시간
  // 다중 schedule이 있으면 모두 합산 (단순 평균 — 정밀 매칭은 추후)
  let totalHours = 0;
  // 반 ID별로 평균 세션 시간 캐싱
  const classHourMap = new Map<string, number>();
  const { data: schedules } = await supabase
    .from("class_schedules")
    .select("class_id, start_time, end_time")
    .in("class_id", classIds);
  for (const s of schedules ?? []) {
    const [sh, sm] = String(s.start_time).split(":").map(Number);
    const [eh, em] = String(s.end_time).split(":").map(Number);
    const hours = eh + em / 60 - (sh + sm / 60);
    const cur = classHourMap.get(s.class_id) ?? 0;
    classHourMap.set(s.class_id, cur + hours);
  }
  // 한 반의 schedule을 평균으로 (다중 요일이면 / count)
  const scheduleCountMap = new Map<string, number>();
  for (const s of schedules ?? []) {
    scheduleCountMap.set(s.class_id, (scheduleCountMap.get(s.class_id) ?? 0) + 1);
  }
  for (const [cid, total] of classHourMap) {
    const cnt = scheduleCountMap.get(cid) ?? 1;
    classHourMap.set(cid, total / cnt);
  }

  // 학생별·날짜별 출석 row → 반의 평균 시간 합산
  // attendance row 1건당 한 반의 1세션 → class 시간 추가
  // 학생 N명이 같은 세션 = N건 출석 → 학생별로 카운트하지 말고 (날짜, 반) 별 unique 처리
  const sessions = new Set<string>();
  for (const a of attendances ?? []) {
    const cls = (Array.isArray(a.class) ? a.class[0] : a.class) as { id?: string } | undefined;
    if (!cls?.id) continue;
    sessions.add(`${cls.id}::${a.session_date}`);
  }
  for (const key of sessions) {
    const [cid] = key.split("::");
    const hours = classHourMap.get(cid) ?? 1;
    totalHours += hours;
  }

  return {
    period,
    baseAmount: monthlyBase,
    hoursWorked: Math.round(totalHours * 100) / 100,
    hourlyAmount: Math.round(totalHours * hourlyRate),
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
