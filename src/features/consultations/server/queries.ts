import "server-only";
import { createClient } from "@/lib/supabase/server";

export type StudentConsultationRow = {
  id: string;
  studentId: string;
  studentName: string;
  studentGrade: string | null;
  counselorName: string | null;
  consultedAt: string;
  summary: string;
  followUpAction: string | null;
};

export async function getStudentConsultations(): Promise<StudentConsultationRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("student_consultations")
    .select(
      `id, consulted_at, summary, follow_up_action,
       student:student_id ( id, name, grade ),
       counselor:counselor_id ( display_name )`,
    )
    .order("consulted_at", { ascending: false });

  if (!data) return [];

  return data.map((r) => {
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
      counselorName: counselor?.display_name ?? null,
      consultedAt: r.consulted_at,
      summary: r.summary,
      followUpAction: r.follow_up_action,
    };
  });
}
