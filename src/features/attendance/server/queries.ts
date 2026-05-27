import "server-only";
import { createClient } from "@/lib/supabase/server";

export type AttendanceStatus = "present" | "absent" | "late" | "excused" | "makeup";

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

export type ClassMeta = {
  id: string;
  className: string;
  subject: string;
  teacherName: string | null;
};

export type AttendanceInputRow = {
  studentId: string;
  studentName: string;
  studentGrade: string | null;
  enrollmentId: string;
  existingRecordId: string | null;
  status: AttendanceStatus | null;
};

export async function getClassMeta(classId: string): Promise<ClassMeta | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("classes")
    .select("id, class_name, subject, teacher:teacher_id ( display_name )")
    .eq("id", classId)
    .single();
  if (!data) return null;
  const teacher = (Array.isArray(data.teacher) ? data.teacher[0] : data.teacher) as
    | { display_name?: string }
    | undefined;
  return {
    id: data.id,
    className: data.class_name,
    subject: data.subject,
    teacherName: teacher?.display_name ?? null,
  };
}

/** Active enrollments + their current attendance record for one (class, date). */
export async function getAttendanceInputRows(
  classId: string,
  date: string,
): Promise<AttendanceInputRow[]> {
  const supabase = await createClient();

  const { data: enrollments } = await supabase
    .from("enrollments")
    .select(
      `id, start_date, end_date, on_hold,
       student:student_id ( id, name, grade )`,
    )
    .eq("class_id", classId)
    .lte("start_date", date);

  const active = (enrollments ?? []).filter(
    (e) => !e.on_hold && (!e.end_date || e.end_date >= date),
  );

  const studentIds = active
    .map((e) => {
      const s = (Array.isArray(e.student) ? e.student[0] : e.student) as
        | { id: string }
        | undefined;
      return s?.id;
    })
    .filter((id): id is string => !!id);

  let recordMap = new Map<string, { id: string; status: AttendanceStatus }>();
  if (studentIds.length > 0) {
    const { data: records } = await supabase
      .from("attendance_records")
      .select("id, student_id, status, recorded_at")
      .eq("class_id", classId)
      .eq("session_date", date)
      .in("student_id", studentIds)
      .order("recorded_at", { ascending: false });

    // Keep the latest record per student (records are sorted desc by recorded_at)
    recordMap = new Map();
    for (const r of records ?? []) {
      if (!recordMap.has(r.student_id)) {
        recordMap.set(r.student_id, { id: r.id, status: r.status as AttendanceStatus });
      }
    }
  }

  return active
    .map((e) => {
      const s = (Array.isArray(e.student) ? e.student[0] : e.student) as
        | { id: string; name: string; grade: string | null }
        | undefined;
      if (!s) return null;
      const existing = recordMap.get(s.id);
      return {
        studentId: s.id,
        studentName: s.name,
        studentGrade: s.grade,
        enrollmentId: e.id,
        existingRecordId: existing?.id ?? null,
        status: existing?.status ?? null,
      } satisfies AttendanceInputRow;
    })
    .filter((r): r is AttendanceInputRow => r !== null)
    .sort((a, b) => {
      const ga = a.studentGrade ?? "";
      const gb = b.studentGrade ?? "";
      if (ga !== gb) return ga.localeCompare(gb, "ko");
      return a.studentName.localeCompare(b.studentName, "ko");
    });
}

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
