import "server-only";
import { createClient } from "@/lib/supabase/server";

export type StudentConsultationCategory =
  | "general"
  | "academic"
  | "emotional"
  | "career"
  | "social"
  | "other";

export type StudentConsultationAudience = "parent" | "student" | "both";

export type StudentConsultationRow = {
  id: string;
  studentId: string;
  studentName: string;
  studentGrade: string | null;
  counselorName: string | null;
  consultedAt: string;
  category: StudentConsultationCategory | null;
  subject: string | null;
  audience: StudentConsultationAudience | null;
  summary: string;
  followUpAction: string | null;
  followUpDate: string | null;
  followUpDone: boolean;
};

export type StudentConsultationDetail = StudentConsultationRow & {
  counselorId: string | null;
};

const SELECT_COLUMNS = `id, consulted_at, summary, follow_up_action,
  follow_up_date, follow_up_done, category, subject, audience, counselor_id,
  student:student_id ( id, name, grade ),
  counselor:counselor_id ( display_name )`;

function mapRow(r: {
  id: string;
  consulted_at: string;
  summary: string;
  follow_up_action: string | null;
  follow_up_date: string | null;
  follow_up_done: boolean;
  category: string | null;
  subject: string | null;
  audience: string | null;
  counselor_id: string | null;
  student: unknown;
  counselor: unknown;
}): StudentConsultationDetail {
  const student = (Array.isArray(r.student) ? r.student[0] : r.student) as
    | { id: string; name: string; grade: string | null }
    | undefined;
  const counselor = (Array.isArray(r.counselor) ? r.counselor[0] : r.counselor) as
    | { display_name?: string }
    | undefined;
  return {
    id: r.id,
    studentId: student?.id ?? "",
    studentName: student?.name ?? "?",
    studentGrade: student?.grade ?? null,
    counselorId: r.counselor_id,
    counselorName: counselor?.display_name ?? null,
    consultedAt: r.consulted_at,
    category: r.category as StudentConsultationCategory | null,
    subject: r.subject,
    audience: r.audience as StudentConsultationAudience | null,
    summary: r.summary,
    followUpAction: r.follow_up_action,
    followUpDate: r.follow_up_date,
    followUpDone: r.follow_up_done,
  };
}

export async function getStudentConsultations(): Promise<StudentConsultationRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("student_consultations")
    .select(SELECT_COLUMNS)
    .order("consulted_at", { ascending: false });

  if (!data) return [];
  return data.map(mapRow);
}

export async function getStudentConsultationById(
  id: string,
): Promise<StudentConsultationDetail | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("student_consultations")
    .select(SELECT_COLUMNS)
    .eq("id", id)
    .single();
  if (!data) return null;
  return mapRow(data);
}

/** follow-up 긴급도: ijw의 getFollowUpUrgency() 포팅 */
export type FollowUpUrgency = "done" | "overdue" | "today" | "soon" | "later" | "none";

export function followUpUrgency(
  date: string | null,
  done: boolean,
): FollowUpUrgency {
  if (done) return "done";
  if (!date) return "none";
  const target = new Date(date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  const diff = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (diff < 0) return "overdue";
  if (diff === 0) return "today";
  if (diff <= 3) return "soon";
  return "later";
}

export type StudentOption = {
  id: string;
  name: string;
  grade: string | null;
};

export async function getStudentOptionsForConsultation(): Promise<StudentOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("students")
    .select("id, name, grade, status")
    .neq("status", "withdrawn")
    .order("grade", { ascending: true })
    .order("name", { ascending: true });
  if (!data) return [];
  return data.map((r) => ({ id: r.id, name: r.name, grade: r.grade }));
}

// ────────────────────── 통계뷰 ──────────────────────

export type ConsultationFunnelPoint = {
  enrollmentConsultations: number; // 등록상담 전체
  studentConsultations: number; // 학생상담 전체
  enrolled: number; // 등록상담 → 학생전환된 수 (linked_student_id 채워진 row)
  conversionRate: number; // enrolled / enrollmentConsultations
};

export async function getConsultationFunnel(
  monthCount = 6,
): Promise<ConsultationFunnelPoint> {
  const supabase = await createClient();
  const since = new Date();
  since.setMonth(since.getMonth() - monthCount);
  const sinceIso = since.toISOString();

  const [
    { count: ec },
    { count: sc },
    { count: enr },
  ] = await Promise.all([
    supabase
      .from("enrollment_consultations")
      .select("*", { count: "exact", head: true })
      .gte("consulted_at", sinceIso),
    supabase
      .from("student_consultations")
      .select("*", { count: "exact", head: true })
      .gte("consulted_at", sinceIso),
    supabase
      .from("enrollment_consultations")
      .select("*", { count: "exact", head: true })
      .gte("consulted_at", sinceIso)
      .not("student_id", "is", null),
  ]);

  const enrollmentConsultations = ec ?? 0;
  const enrolled = enr ?? 0;
  return {
    enrollmentConsultations,
    studentConsultations: sc ?? 0,
    enrolled,
    conversionRate:
      enrollmentConsultations > 0 ? (enrolled / enrollmentConsultations) * 100 : 0,
  };
}

export type CategoryBucket = { category: string; count: number };

export async function getConsultationByCategory(
  monthCount = 6,
): Promise<CategoryBucket[]> {
  const supabase = await createClient();
  const since = new Date();
  since.setMonth(since.getMonth() - monthCount);
  const sinceIso = since.toISOString();

  const { data } = await supabase
    .from("student_consultations")
    .select("category")
    .gte("consulted_at", sinceIso);

  const counts = new Map<string, number>();
  for (const r of data ?? []) {
    const key = (r.category as string) ?? "other";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries()).map(([category, count]) => ({ category, count }));
}

export type MonthlyBucket = { month: string; enrollment: number; student: number };

export async function getConsultationTrend(monthCount = 6): Promise<MonthlyBucket[]> {
  const supabase = await createClient();
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - monthCount + 1, 1);

  const [{ data: ec }, { data: sc }] = await Promise.all([
    supabase
      .from("enrollment_consultations")
      .select("consulted_at")
      .gte("consulted_at", start.toISOString()),
    supabase
      .from("student_consultations")
      .select("consulted_at")
      .gte("consulted_at", start.toISOString()),
  ]);

  const buckets = new Map<string, MonthlyBucket>();
  for (let i = 0; i < monthCount; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    buckets.set(k, { month: k, enrollment: 0, student: 0 });
  }

  for (const r of ec ?? []) {
    const d = new Date(r.consulted_at);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const b = buckets.get(k);
    if (b) b.enrollment++;
  }
  for (const r of sc ?? []) {
    const d = new Date(r.consulted_at);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const b = buckets.get(k);
    if (b) b.student++;
  }

  return Array.from(buckets.values());
}
