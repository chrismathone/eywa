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
