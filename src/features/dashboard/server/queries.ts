import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchInChunks } from "@/lib/supabase/batch";
import { kstToday, kstMonthStart, kstMonth } from "@/lib/date-kst";
import { attendanceRate } from "@/lib/calc/attendance";
import { schoolGradeLabel } from "@/lib/format/school-grade";
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

/** 이번 달 신규 등록 + 퇴원 학생 명단(드릴다운용). 밴드 카운트도 배열 길이로 도출(별도 count 쿼리 불요). */
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

export type SubjectChange = { subject: string; newCount: number; withdrawnCount: number; net: number };
export type EnrollmentChangeSummary = {
  days: number;
  newCount: number;
  withdrawnCount: number;
  net: number;
  bySubject: SubjectChange[]; // 순증감 낮은 순(퇴원 많은 과목 먼저)
};

/**
 * 최근 N일(기본 7) 학생 증감 — 신규 등록/퇴원 수(전체) + 과목별. 대시보드 "최근 7일" 카드.
 * 전체 카운트는 count:exact head:true(행 미수신, B2). 과목별은 창 내 학생 id(7일 창=소량)를 받아 수강 반 과목으로
 * 집계(fetchInChunks, B3) — 한 학생이 2과목이면 각 과목에 계수(과목별 합 ≠ 전체는 정상, 학생 중복 제거는 과목 단위).
 * 신규=활성 수강(end_date null)의 과목, 퇴원=그 학생의 (종료 포함) 수강 과목.
 */
export async function getEnrollmentChangeLast7d(days = 7): Promise<EnrollmentChangeSummary> {
  const supabase = await createClient();
  const since = toIsoDate(new Date(Date.parse(`${kstToday()}T00:00:00Z`) - days * 86_400_000));

  const [newCntRes, wdCntRes, newIdRes, wdIdRes] = await Promise.all([
    supabase.from("students").select("*", { count: "exact", head: true }).eq("status", "enrolled").gte("enrolled_at", since),
    supabase.from("students").select("*", { count: "exact", head: true }).eq("status", "withdrawn").gte("withdrawn_at", since),
    // 과목별용 id — 7일 창이라 소량. limit로 이상 급증 시 상한(전체 카운트는 위 count가 정확).
    supabase.from("students").select("id").eq("status", "enrolled").gte("enrolled_at", since).limit(2000),
    supabase.from("students").select("id").eq("status", "withdrawn").gte("withdrawn_at", since).limit(2000),
  ]);
  const newCount = newCntRes.count ?? 0;
  const withdrawnCount = wdCntRes.count ?? 0;

  const subjOf = (row: { class: unknown }): string | null => {
    const c = (Array.isArray(row.class) ? row.class[0] : row.class) as { subject?: string | null } | undefined;
    return c?.subject ?? null;
  };
  const aggregate = async (ids: string[], activeOnly: boolean): Promise<Map<string, Set<string>>> => {
    const bySubj = new Map<string, Set<string>>();
    if (ids.length === 0) return bySubj;
    const rows = await fetchInChunks<{ student_id: string; class: unknown }>(ids, (chunk) => {
      let q = supabase.from("enrollments").select("student_id, class:class_id(subject)").in("student_id", chunk);
      if (activeOnly) q = q.is("end_date", null);
      return q;
    });
    for (const r of rows) {
      const s = subjOf(r);
      if (!s) continue;
      (bySubj.get(s) ?? bySubj.set(s, new Set()).get(s)!).add(r.student_id);
    }
    return bySubj;
  };
  const [newBySubj, wdBySubj] = await Promise.all([
    aggregate((newIdRes.data ?? []).map((r) => r.id as string), true),
    aggregate((wdIdRes.data ?? []).map((r) => r.id as string), false),
  ]);

  const subjects = new Set([...newBySubj.keys(), ...wdBySubj.keys()]);
  const bySubject: SubjectChange[] = [...subjects]
    .map((subject) => {
      const nc = newBySubj.get(subject)?.size ?? 0;
      const wc = wdBySubj.get(subject)?.size ?? 0;
      return { subject, newCount: nc, withdrawnCount: wc, net: nc - wc };
    })
    .sort((a, b) => a.net - b.net); // 순감 큰(퇴원 많은) 과목 먼저

  return { days, newCount, withdrawnCount, net: newCount - withdrawnCount, bySubject };
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
  createdAt: string;
  authorName: string | null;
};

/**
 * 공지 관리 모달용 — 최근 공지(고정 우선) 목록. AnnouncementRow의 상위집합(작성자·일시 포함)이라
 * canManage면 카드(앞 4건)도 여기서 도출 = getRecentAnnouncements 이중 fetch 제거(정렬 동일).
 */
export async function getAnnouncementsForManage(limit = 30): Promise<ManageAnnouncementRow[]> {
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
    const a = (Array.isArray(row.author) ? row.author[0] : row.author) as
      | { display_name?: string }
      | undefined;
    return {
      id: row.id,
      title: row.title,
      content: row.content,
      audience: row.audience,
      pinned: row.pinned,
      createdAt: row.created_at as string,
      authorName: a?.display_name ?? null,
    };
  });
}

export type TrendPoint = {
  date: string; // "5/26"
  day: string; // "월"
  attendance: number; // 0–100
  payment: number; // placeholder until invoices land
};

export type DashEnrollmentRow = {
  id: string;
  name: string;
  /** 학교·학년 (없으면 null) */
  meta: string | null;
  outcome: "pending" | "scheduled" | "consulted" | "ai_done";
  /** 상담일(consultation_date) ?? 접수 시각 날짜부 — "YYYY-MM-DD" */
  date: string | null;
};

export type DashEnrollmentList = { total: number; rows: DashEnrollmentRow[] };

/** 등록상담 목록(활성 = 대기·예약·상담완료·AI완료) — 최근 순 limit건 + 전체 활성 건수(count exact, 절단 무관). */
export async function getActiveEnrollmentConsultations(limit = 6): Promise<DashEnrollmentList> {
  const supabase = await createClient();
  const { data, count } = await supabase
    .from("enrollment_consultations")
    .select("id, prospect_name, prospect_school, prospect_grade, outcome, consultation_date, consulted_at", {
      count: "exact",
    })
    .in("outcome", ["pending", "scheduled", "consulted", "ai_done"])
    .order("consulted_at", { ascending: false })
    .limit(limit);
  const rows: DashEnrollmentRow[] = (data ?? []).map((r) => ({
    id: r.id as string,
    name: (r.prospect_name as string | null) ?? "(이름 없음)",
    meta: schoolGradeLabel(r.prospect_school as string | null, r.prospect_grade as string | null) || null,
    outcome: r.outcome as DashEnrollmentRow["outcome"],
    date:
      (r.consultation_date as string | null) ??
      (typeof r.consulted_at === "string" ? r.consulted_at.slice(0, 10) : null),
  }));
  return { total: count ?? 0, rows };
}

export type UnassignedEnrolled = {
  studentId: string;
  name: string;
  meta: string | null; // 학교·학년 압축 라벨
  enrolledAt: string | null; // 등록일(YYYY-MM-DD)
};

/**
 * 등록됨(enrolled)인데 활성 수강(반)이 없는 학생 = "배정 필요". anti-join RPC(0097a, security invoker +
 * auth_tenant_id 이중격리) — 대시보드 반응속도 1순위라 전건 fetch+JS 대신 DB 1쿼리. limit는 count 정확도용
 * 안전 상한(현실적으로 소수 — 배정되면 목록에서 빠짐). 호출부가 rows.length를 "배정 필요 N명"으로 사용.
 */
export async function getUnassignedEnrolledStudents(limit = 30): Promise<UnassignedEnrolled[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("dashboard_unassigned_enrolled", { p_limit: limit });
  if (error) throw new Error(`getUnassignedEnrolledStudents: ${error.message}`);
  return (
    (data ?? []) as Array<{ student_id: string; student_name: string; grade: string | null; school: string | null; enrolled_at: string | null }>
  ).map((r) => ({
    studentId: r.student_id,
    name: r.student_name,
    meta: schoolGradeLabel(r.school, r.grade) || null,
    enrolledAt: r.enrolled_at,
  }));
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
    .select("amount_total, amount_paid, amount_discount, status")
    .eq("period", period);
  if (!data || data.length === 0) return null;

  const totalBilled = data.reduce((s, r) => s + Number(r.amount_total), 0);
  const totalPaid = data.reduce((s, r) => s + Number(r.amount_paid), 0);
  const totalDiscount = data.reduce((s, r) => s + Number(r.amount_discount ?? 0), 0);
  const paidCount = data.filter((r) => r.status === "paid").length;
  const unpaidCount = data.filter((r) => r.status === "unpaid" || r.status === "partial").length;
  return {
    period,
    totalCount: data.length,
    paidCount,
    unpaidCount,
    paymentRate: totalBilled > 0 ? (totalPaid / totalBilled) * 100 : 0,
    // 미수 총액 = 청구 - 납부 - 할인(할인 빼면 과대계상 — 밴드 '이번 달 미수'가 소비).
    outstanding: Math.max(0, totalBilled - totalPaid - totalDiscount),
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
