import "server-only";
import { createClient } from "@/lib/supabase/server";
import { kstToday, kstMonthStart, kstMonth } from "@/lib/date-kst";
import { attendanceRate } from "@/lib/calc/attendance";
import { followUpUrgency, type FollowUpUrgency } from "@/features/consultations/server/queries";

const KO_DAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;

function toIsoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function shortMd(d: Date) {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export async function getEnrolledStudentCount(): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("students")
    .select("*", { count: "exact", head: true })
    .eq("status", "enrolled");
  return count ?? 0;
}

export async function getNewStudentsThisMonth(): Promise<number> {
  const supabase = await createClient();
  const startIso = kstMonthStart();
  const { count } = await supabase
    .from("students")
    .select("*", { count: "exact", head: true })
    .eq("status", "enrolled")
    .gte("enrolled_at", startIso);
  return count ?? 0;
}

export async function getWithdrawalsThisMonth(): Promise<number> {
  const supabase = await createClient();
  const startIso = kstMonthStart();
  const { count } = await supabase
    .from("students")
    .select("*", { count: "exact", head: true })
    .eq("status", "withdrawn")
    .gte("withdrawn_at", startIso);
  return count ?? 0;
}

export type EnrollmentChangeStudent = {
  id: string;
  name: string;
  grade: string | null;
  school: string | null;
  date: string | null;
};
export type EnrollmentChanges = {
  newStudents: EnrollmentChangeStudent[];
  withdrawn: EnrollmentChangeStudent[];
};

/** 이번 달 신규 등록 + 퇴원 학생 명단(드릴다운용). 카운트는 getNew/WithdrawalsThisMonth와 동일 기준. */
export async function getMonthlyEnrollmentChanges(): Promise<EnrollmentChanges> {
  const supabase = await createClient();
  const startIso = kstMonthStart();
  const [{ data: nw }, { data: wd }] = await Promise.all([
    supabase
      .from("students")
      .select("id, name, grade, school, enrolled_at")
      .eq("status", "enrolled")
      .gte("enrolled_at", startIso)
      .order("enrolled_at", { ascending: false }),
    supabase
      .from("students")
      .select("id, name, grade, school, withdrawn_at")
      .eq("status", "withdrawn")
      .gte("withdrawn_at", startIso)
      .order("withdrawn_at", { ascending: false }),
  ]);
  return {
    newStudents: (nw ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      grade: s.grade,
      school: s.school,
      date: s.enrolled_at,
    })),
    withdrawn: (wd ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      grade: s.grade,
      school: s.school,
      date: s.withdrawn_at,
    })),
  };
}

export type AttendanceSnapshot = {
  date: string;
  total: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
  rate: number;
};

async function snapshotForDate(date: string): Promise<AttendanceSnapshot | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("attendance_records")
    .select("status")
    .eq("session_date", date);

  if (!data || data.length === 0) return null;

  const present = data.filter((r) => r.status === "present").length;
  const absent = data.filter((r) => r.status === "absent").length;
  const late = data.filter((r) => r.status === "late").length;
  const excused = data.filter((r) => r.status === "excused").length;
  const total = data.length;
  return {
    date,
    total,
    present,
    absent,
    late,
    excused,
    rate: attendanceRate(present, total),
  };
}

export async function getMostRecentAttendanceSnapshot(): Promise<AttendanceSnapshot | null> {
  const today = kstToday();
  const todaySnap = await snapshotForDate(today);
  if (todaySnap) return todaySnap;

  const supabase = await createClient();
  const { data: recent } = await supabase
    .from("attendance_records")
    .select("session_date")
    .order("session_date", { ascending: false })
    .limit(1);
  const fallback = recent?.[0]?.session_date;
  if (!fallback) return null;
  return snapshotForDate(fallback);
}

export type AnnouncementRow = {
  id: string;
  title: string;
  content: string;
  audience: string;
  pinned: boolean;
  createdAt: string;
  authorName: string | null;
};

export async function getRecentAnnouncements(limit = 3): Promise<AnnouncementRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("announcements")
    .select(
      `id, title, content, audience, pinned, created_at,
       author:author_id ( display_name )`,
    )
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!data) return [];

  return data.map((row) => {
    const authorField = row.author as { display_name?: string } | { display_name?: string }[] | null;
    let authorName: string | null = null;
    if (Array.isArray(authorField)) {
      authorName = authorField[0]?.display_name ?? null;
    } else if (authorField) {
      authorName = authorField.display_name ?? null;
    }
    return {
      id: row.id,
      title: row.title,
      content: row.content,
      audience: row.audience,
      pinned: row.pinned,
      createdAt: row.created_at,
      authorName,
    };
  });
}

/** 오늘 출석을 1건이라도 기록한 반 id 집합 — '미기록' 추적용(시작한 수업 기준 판정은 호출부에서). */
export async function getTodayRecordedClassIds(): Promise<string[]> {
  const supabase = await createClient();
  const today = kstToday();
  const { data } = await supabase
    .from("attendance_records")
    .select("class_id")
    .eq("session_date", today);
  return [...new Set((data ?? []).map((r) => r.class_id as string))];
}

export type DashFollowUp = {
  id: string;
  studentId: string;
  studentName: string;
  followUpAction: string | null;
  followUpDate: string | null;
  urgency: FollowUpUrgency;
};

/** 학생상담 후속조치 — 미완료 + 기한 임박/경과(긴급도 overdue/today/soon)만, 빠른 순. */
export async function getFollowUpConsultations(limit = 8): Promise<DashFollowUp[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("student_consultations")
    .select("id, student_id, follow_up_action, follow_up_date, student:student_id ( name )")
    .eq("follow_up_done", false)
    .not("follow_up_date", "is", null)
    .order("follow_up_date", { ascending: true })
    .limit(60);
  const rows: DashFollowUp[] = [];
  for (const r of data ?? []) {
    const u = followUpUrgency(r.follow_up_date as string | null, false);
    if (u !== "overdue" && u !== "today" && u !== "soon") continue;
    const st = (Array.isArray(r.student) ? r.student[0] : r.student) as { name?: string } | undefined;
    rows.push({
      id: r.id,
      studentId: r.student_id,
      studentName: st?.name ?? "(학생)",
      followUpAction: r.follow_up_action,
      followUpDate: r.follow_up_date,
      urgency: u,
    });
    if (rows.length >= limit) break;
  }
  return rows;
}

export type ManageAnnouncementRow = {
  id: string;
  title: string;
  content: string;
  audience: string;
  pinned: boolean;
};

/** 공지 관리 모달용 — 최근 공지(고정 우선) 목록. 카드(getRecentAnnouncements)보다 길게. */
export async function getAnnouncementsForManage(limit = 30): Promise<ManageAnnouncementRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("announcements")
    .select("id, title, content, audience, pinned, created_at")
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (!data) return [];
  return data.map((row) => ({
    id: row.id,
    title: row.title,
    content: row.content,
    audience: row.audience,
    pinned: row.pinned,
  }));
}

export type TrendPoint = {
  date: string; // "5/26"
  day: string; // "월"
  attendance: number; // 0–100
  payment: number; // placeholder until invoices land
};

export type ConsultationPipeline = {
  total: number;
  pending: number;
  scheduled: number;
  consulted: number;
  aiDone: number;
};

export async function getActiveConsultationsCount(): Promise<ConsultationPipeline> {
  const supabase = await createClient();
  // SQL count(exact, head) 4개 병렬 — 활성 상담 전건을 끌어와 JS로 세던 것 교체(#P1: 1000행 절단 위험).
  const base = () =>
    supabase.from("enrollment_consultations").select("*", { count: "exact", head: true });
  const [pending, scheduled, consulted, aiDone] = await Promise.all([
    base().eq("outcome", "pending"),
    base().eq("outcome", "scheduled"),
    base().eq("outcome", "consulted"),
    base().eq("outcome", "ai_done"),
  ]);
  const p = pending.count ?? 0;
  const s = scheduled.count ?? 0;
  const c = consulted.count ?? 0;
  const a = aiDone.count ?? 0;
  return { total: p + s + c + a, pending: p, scheduled: s, consulted: c, aiDone: a };
}

export type PaymentSnapshot = {
  period: string;
  totalCount: number;
  paidCount: number;
  unpaidCount: number;
  paymentRate: number;
  outstanding: number;
};

export async function getPaymentRateThisMonth(): Promise<PaymentSnapshot | null> {
  const supabase = await createClient();
  const period = kstMonth();
  const { data } = await supabase
    .from("invoices")
    .select("amount_total, amount_paid, status")
    .eq("period", period);
  if (!data || data.length === 0) return null;

  const totalBilled = data.reduce((s, r) => s + Number(r.amount_total), 0);
  const totalPaid = data.reduce((s, r) => s + Number(r.amount_paid), 0);
  const paidCount = data.filter((r) => r.status === "paid").length;
  const unpaidCount = data.filter((r) => r.status === "unpaid" || r.status === "partial").length;
  return {
    period,
    totalCount: data.length,
    paidCount,
    unpaidCount,
    paymentRate: totalBilled > 0 ? (totalPaid / totalBilled) * 100 : 0,
    outstanding: totalBilled - totalPaid,
  };
}

export async function getTrendDataLast7Days(): Promise<TrendPoint[]> {
  const supabase = await createClient();
  // Window ends yesterday — today is still in progress and shouldn't drag the
  // line to 0% just because attendance hasn't been recorded yet.
  const end = new Date();
  end.setDate(end.getDate() - 1);
  const start = new Date(end);
  start.setDate(end.getDate() - 6);

  const [{ data: attRows }, { data: invRows }] = await Promise.all([
    supabase
      .from("attendance_records")
      .select("session_date, status")
      .gte("session_date", toIsoDate(start))
      .lte("session_date", toIsoDate(end)),
    // 이번 달 invoices — 누적 수납률 계산용 (paid_at 일자별)
    supabase
      .from("invoices")
      .select("amount_total, amount_paid, paid_at, status")
      .eq("period", currentPeriod()),
  ]);

  const byDate = new Map<string, { total: number; present: number }>();
  for (const r of attRows ?? []) {
    const d = r.session_date as string;
    if (!byDate.has(d)) byDate.set(d, { total: 0, present: 0 });
    const g = byDate.get(d)!;
    g.total += 1;
    if (r.status === "present") g.present += 1;
  }

  // invoices 누적: 이번 달 청구 총액 + 각 날짜까지 paid_at 누적
  const totalBilled = (invRows ?? []).reduce((s, r) => s + Number(r.amount_total), 0);
  function paymentRateUpTo(isoDay: string): number {
    if (totalBilled === 0) return 0;
    const paidSoFar = (invRows ?? [])
      .filter((r) => r.paid_at && String(r.paid_at).slice(0, 10) <= isoDay)
      .reduce((s, r) => s + Number(r.amount_paid), 0);
    return (paidSoFar / totalBilled) * 100;
  }

  const result: TrendPoint[] = [];
  for (let i = 6; i >= 0; i--) {
    const day = new Date(end);
    day.setDate(end.getDate() - i);
    const iso = toIsoDate(day);
    const stats = byDate.get(iso) ?? { total: 0, present: 0 };
    const rate = stats.total > 0 ? (stats.present / stats.total) * 100 : 0;
    result.push({
      date: shortMd(day),
      day: KO_DAYS[day.getDay()],
      attendance: Number(rate.toFixed(1)),
      payment: Number(paymentRateUpTo(iso).toFixed(1)),
    });
  }
  return result;
}

function currentPeriod(): string {
  return kstMonth();
}

// ─────────── 추가 대시보드 위젯 ───────────

export type UpcomingPayment = {
  studentId: string;
  studentName: string;
  amount: number;
  dueDate: string;
  daysUntilDue: number;
};

/** 이번 주 결제 예정 (due_date 이내 7일, unpaid/partial). */
export async function getUpcomingPayments(daysAhead = 7): Promise<UpcomingPayment[]> {
  const supabase = await createClient();
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const limit = new Date(today);
  limit.setDate(limit.getDate() + daysAhead);
  const limitIso = limit.toISOString().slice(0, 10);

  const { data } = await supabase
    .from("invoices")
    .select(
      `id, amount_total, amount_paid, amount_discount, due_date,
       student:student_id ( id, name )`,
    )
    .gte("due_date", todayIso)
    .lte("due_date", limitIso)
    .in("status", ["unpaid", "partial"])
    .order("due_date");

  return (data ?? [])
    .map((r) => {
      const stu = (Array.isArray(r.student) ? r.student[0] : r.student) as
        | { id: string; name: string }
        | undefined;
      if (!stu) return null;
      const balance =
        Number(r.amount_total) - Number(r.amount_paid) - Number(r.amount_discount ?? 0);
      const due = new Date(r.due_date as string);
      const days = Math.max(0, Math.round((due.getTime() - today.getTime()) / 86_400_000));
      return {
        studentId: stu.id,
        studentName: stu.name,
        amount: balance,
        dueDate: r.due_date as string,
        daysUntilDue: days,
      } satisfies UpcomingPayment;
    })
    .filter((r): r is UpcomingPayment => r !== null);
}

export type OutstandingItem = {
  studentId: string;
  studentName: string;
  amount: number; // 잔액(미납)
  status: string; // unpaid | partial
};

/**
 * 미수 상위 — unpaid/partial 인보이스의 잔액 큰 순(이름 명단). 밴드의 '미수 N건'(카운트)에
 * '누구'를 붙이는 명단. due_date 창에 의존하지 않아 항상 채워진다(데모 미납 187건).
 */
export async function getTopOutstanding(limit = 8): Promise<OutstandingItem[]> {
  const supabase = await createClient();
  // 학생별 미납 잔액 합산 top N — DB group-by RPC 1쿼리(구: 전건 fetch + JS 집계, 0039a).
  const { data, error } = await supabase.rpc("dashboard_top_outstanding", { p_limit: limit });
  if (error) throw new Error(`getTopOutstanding: ${error.message}`);
  return (
    (data ?? []) as Array<{ student_id: string; student_name: string; amount: number | string; status: string }>
  ).map((r) => ({
    studentId: r.student_id,
    studentName: r.student_name,
    amount: Number(r.amount),
    status: r.status,
  }));
}

export type AbsenceRisk = {
  studentId: string;
  studentName: string;
  absences: number;
};

/**
 * 결석 위험 학생: 최근 14일 결석 ≥ 3건. 단 데모 출결이 과거에 몰려 있어 'today-14d'로는 0건이 되므로
 * 가장 최근 기록일을 앵커로 그 직전 14일 창을 본다(실데이터가 최신이면 today와 동일하게 동작).
 */
export async function getAbsenceRiskStudents(): Promise<AbsenceRisk[]> {
  const supabase = await createClient();
  // 최근 기록일 기준 14일 결석 ≥3 — DB group-by/having RPC 1쿼리(구: anchor + 전건 조인 + JS, 0039a).
  const { data, error } = await supabase.rpc("dashboard_absence_risk", { p_min: 3 });
  if (error) throw new Error(`getAbsenceRiskStudents: ${error.message}`);
  return ((data ?? []) as Array<{ student_id: string; student_name: string; absences: number | string }>).map((r) => ({
    studentId: r.student_id,
    studentName: r.student_name,
    absences: Number(r.absences),
  }));
}
