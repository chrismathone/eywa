import "server-only";
import { createClient } from "@/lib/supabase/server";

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
  const start = new Date();
  start.setDate(1);
  const { count } = await supabase
    .from("students")
    .select("*", { count: "exact", head: true })
    .eq("status", "enrolled")
    .gte("enrolled_at", toIsoDate(start));
  return count ?? 0;
}

export async function getWithdrawalsThisMonth(): Promise<number> {
  const supabase = await createClient();
  const start = new Date();
  start.setDate(1);
  const { count } = await supabase
    .from("students")
    .select("*", { count: "exact", head: true })
    .eq("status", "withdrawn")
    .gte("withdrawn_at", toIsoDate(start));
  return count ?? 0;
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
    rate: total > 0 ? (present / total) * 100 : 0,
  };
}

export async function getMostRecentAttendanceSnapshot(): Promise<AttendanceSnapshot | null> {
  const today = toIsoDate(new Date());
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
  const { data } = await supabase
    .from("enrollment_consultations")
    .select("outcome")
    .in("outcome", ["pending", "scheduled", "consulted", "ai_done"]);

  const rows = data ?? [];
  return {
    total: rows.length,
    pending: rows.filter((r) => r.outcome === "pending").length,
    scheduled: rows.filter((r) => r.outcome === "scheduled").length,
    consulted: rows.filter((r) => r.outcome === "consulted").length,
    aiDone: rows.filter((r) => r.outcome === "ai_done").length,
  };
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
  const d = new Date();
  const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
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
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
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
  const { data } = await supabase
    .from("invoices")
    .select(`amount_total, amount_paid, amount_discount, status, student:student_id ( id, name )`)
    .in("status", ["unpaid", "partial"]);

  // 학생당 잔액 합산(한 학생의 여러 미납 인보이스가 같은 명단에 중복으로 뜨지 않도록).
  const byStudent = new Map<string, OutstandingItem>();
  for (const r of data ?? []) {
    const stu = (Array.isArray(r.student) ? r.student[0] : r.student) as
      | { id: string; name: string }
      | undefined;
    if (!stu) continue;
    const balance =
      Number(r.amount_total) - Number(r.amount_paid) - Number(r.amount_discount ?? 0);
    if (balance <= 0) continue;
    const cur = byStudent.get(stu.id);
    if (cur) {
      cur.amount += balance;
      if (r.status === "unpaid") cur.status = "unpaid"; // 하나라도 완전 미납이면 '미납'
    } else {
      byStudent.set(stu.id, {
        studentId: stu.id,
        studentName: stu.name,
        amount: balance,
        status: r.status as string,
      });
    }
  }

  return [...byStudent.values()].sort((a, b) => b.amount - a.amount).slice(0, limit);
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
  const { data: recent } = await supabase
    .from("attendance_records")
    .select("session_date")
    .order("session_date", { ascending: false })
    .limit(1);
  const anchorIso = recent?.[0]?.session_date as string | undefined;
  if (!anchorIso) return [];
  const since = new Date(anchorIso);
  since.setDate(since.getDate() - 13);
  const sinceIso = since.toISOString().slice(0, 10);

  const { data } = await supabase
    .from("attendance_records")
    .select("student_id, status, student:student_id ( id, name )")
    .eq("status", "absent")
    .gte("session_date", sinceIso)
    .lte("session_date", anchorIso);

  const counts = new Map<string, { name: string; count: number }>();
  for (const r of data ?? []) {
    const stu = (Array.isArray(r.student) ? r.student[0] : r.student) as
      | { id: string; name: string }
      | undefined;
    if (!stu) continue;
    const cur = counts.get(stu.id) ?? { name: stu.name, count: 0 };
    cur.count++;
    counts.set(stu.id, cur);
  }

  return Array.from(counts.entries())
    .filter(([, v]) => v.count >= 3)
    .map(([id, v]) => ({
      studentId: id,
      studentName: v.name,
      absences: v.count,
    }))
    .sort((a, b) => b.absences - a.absences);
}
