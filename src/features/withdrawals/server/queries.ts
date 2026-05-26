import "server-only";
import { createClient } from "@/lib/supabase/server";

export type WithdrawalRow = {
  id: string;
  name: string;
  school: string | null;
  grade: string | null;
  primaryTeacherName: string | null;
  enrolledAt: string | null;
  withdrawnAt: string | null;
  lastClassName: string | null;
  lastClassSubject: string | null;
  withdrawalReason: string | null;
};

export async function getWithdrawnStudents(): Promise<WithdrawalRow[]> {
  const supabase = await createClient();
  const { data: students } = await supabase
    .from("students")
    .select(
      `id, name, school, grade, enrolled_at, withdrawn_at,
       teacher:primary_teacher_id ( display_name )`,
    )
    .eq("status", "withdrawn")
    .order("withdrawn_at", { ascending: false });

  if (!students || students.length === 0) return [];

  const ids = students.map((s) => s.id);

  const { data: enrollments } = await supabase
    .from("enrollments")
    .select(
      `student_id, withdrawal_reason, end_date,
       class:class_id ( class_name, subject )`,
    )
    .in("student_id", ids)
    .not("end_date", "is", null)
    .order("end_date", { ascending: false });

  const lastByStudent = new Map<
    string,
    { reason: string | null; className: string | null; subject: string | null }
  >();
  for (const e of enrollments ?? []) {
    if (lastByStudent.has(e.student_id)) continue;
    const klass = (Array.isArray(e.class) ? e.class[0] : e.class) as
      | { class_name?: string; subject?: string }
      | undefined;
    lastByStudent.set(e.student_id, {
      reason: e.withdrawal_reason ?? null,
      className: klass?.class_name ?? null,
      subject: klass?.subject ?? null,
    });
  }

  return students.map((s) => {
    const teacher = (Array.isArray(s.teacher) ? s.teacher[0] : s.teacher) as
      | { display_name?: string }
      | undefined;
    const last = lastByStudent.get(s.id);
    return {
      id: s.id,
      name: s.name,
      school: s.school,
      grade: s.grade,
      primaryTeacherName: teacher?.display_name ?? null,
      enrolledAt: s.enrolled_at,
      withdrawnAt: s.withdrawn_at,
      lastClassName: last?.className ?? null,
      lastClassSubject: last?.subject ?? null,
      withdrawalReason: last?.reason ?? null,
    };
  });
}
