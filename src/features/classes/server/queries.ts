import "server-only";
import { createClient } from "@/lib/supabase/server";

export type ClassListRow = {
  id: string;
  className: string;
  subject: string;
  teacherName: string | null;
  classroomName: string | null;
  isActive: boolean;
  studentCount: number;
};

export async function getClassesList(): Promise<ClassListRow[]> {
  const supabase = await createClient();

  const { data: classes } = await supabase
    .from("classes")
    .select(
      `id, class_name, subject, is_active,
       teacher:teacher_id ( display_name ),
       classroom:classroom_id ( name )`,
    )
    .order("class_name");

  if (!classes) return [];

  const { data: enrollments } = await supabase
    .from("enrollments")
    .select("class_id")
    .is("end_date", null);

  const counts = new Map<string, number>();
  for (const e of enrollments ?? []) {
    counts.set(e.class_id, (counts.get(e.class_id) ?? 0) + 1);
  }

  return classes.map((c) => {
    const teacher = (Array.isArray(c.teacher) ? c.teacher[0] : c.teacher) as
      | { display_name?: string }
      | undefined;
    const room = (Array.isArray(c.classroom) ? c.classroom[0] : c.classroom) as
      | { name?: string }
      | undefined;
    return {
      id: c.id,
      className: c.class_name,
      subject: c.subject,
      teacherName: teacher?.display_name ?? null,
      classroomName: room?.name ?? null,
      isActive: c.is_active,
      studentCount: counts.get(c.id) ?? 0,
    };
  });
}
