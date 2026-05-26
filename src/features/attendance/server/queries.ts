import "server-only";
import { createClient } from "@/lib/supabase/server";

export type AttendanceRow = {
  id: string;
  status: string;
  studentId: string;
  studentName: string;
  studentGrade: string | null;
  classId: string;
  className: string;
  subject: string;
};

export async function getMostRecentAttendanceDate(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("attendance_records")
    .select("session_date")
    .order("session_date", { ascending: false })
    .limit(1);
  return data?.[0]?.session_date ?? null;
}

export async function getAttendanceForDate(date: string): Promise<AttendanceRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("attendance_records")
    .select(
      `id, status,
       student:student_id ( id, name, grade ),
       class:class_id ( id, class_name, subject )`,
    )
    .eq("session_date", date)
    .order("class_id");

  if (!data) return [];

  return data.map((r) => {
    const student = (Array.isArray(r.student) ? r.student[0] : r.student) as
      | { id: string; name: string; grade: string | null }
      | undefined;
    const klass = (Array.isArray(r.class) ? r.class[0] : r.class) as
      | { id: string; class_name: string; subject: string }
      | undefined;
    return {
      id: r.id,
      status: r.status,
      studentId: student?.id ?? "",
      studentName: student?.name ?? "?",
      studentGrade: student?.grade ?? null,
      classId: klass?.id ?? "",
      className: klass?.class_name ?? "?",
      subject: klass?.subject ?? "?",
    };
  });
}
