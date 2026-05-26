import "server-only";
import { createClient } from "@/lib/supabase/server";

const KO_DAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;

function toIsoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function shortMd(d: Date) {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export type UserProfile = {
  id: string;
  tenantId: string;
  email: string;
  displayName: string;
  systemRole: string;
};

export async function getCurrentUserProfile(): Promise<UserProfile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("users")
    .select("id, tenant_id, email, display_name, system_role")
    .eq("id", user.id)
    .single();

  if (!data) return null;
  return {
    id: data.id,
    tenantId: data.tenant_id,
    email: data.email,
    displayName: data.display_name,
    systemRole: data.system_role,
  };
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

  const { data } = await supabase
    .from("attendance_records")
    .select("session_date, status")
    .gte("session_date", toIsoDate(start))
    .lte("session_date", toIsoDate(end));

  const byDate = new Map<string, { total: number; present: number }>();
  for (const r of data ?? []) {
    const d = r.session_date as string;
    if (!byDate.has(d)) byDate.set(d, { total: 0, present: 0 });
    const g = byDate.get(d)!;
    g.total += 1;
    if (r.status === "present") g.present += 1;
  }

  const result: TrendPoint[] = [];
  // placeholder payment series: slowly trending up
  const paymentBaseline = 78;
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
      payment: Number((paymentBaseline + (6 - i) * 1.4).toFixed(1)),
    });
  }
  return result;
}
