import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { logDbError } from "@/lib/supabase/db-error";
import { buildStudentBasics, unavailableStudentBasics, type BasicEnrollment, type StudentBasics } from "../lib/student-basics";

type EnrollmentRow = { student_id: string; class_id: string; start_date: string | null; end_date: string | null; on_hold: boolean | null; is_transferred: boolean | null };
type ClassRow = { id: string; subject: string; teacher_id: string | null; is_active: boolean; closed_at: string | null; is_makeup_pool: boolean | null };

/**
 * requireMcsClassAccess를 통과한 월간 시트의 표시 학생만 전달한다.
 * 과목·수강 기간·담임 이름만 반환하며 다른 과목의 성적/상담/연락처 권한은 확장하지 않는다.
 */
export async function loadMcsStudentBasics({ admin, tenantId, studentIds, asOf, withdrawnByStudent }: {
  admin: ReturnType<typeof createAdminClient>;
  tenantId: string;
  studentIds: string[];
  asOf: string;
  withdrawnByStudent?: Map<string, string | null>;
}): Promise<Map<string, StudentBasics>> {
  const ids = [...new Set(studentIds)];
  if (!ids.length) return new Map();
  try {
    const enrollments = await fetchAllPagedInChunks<EnrollmentRow>(ids, (chunk, from, to) => admin.from("enrollments")
      .select("student_id, class_id, start_date, end_date, on_hold, is_transferred")
      .eq("tenant_id", tenantId).in("student_id", chunk).order("id").range(from, to));
    const classes = await fetchInChunks<ClassRow>([...new Set(enrollments.map(row => row.class_id))], chunk => admin.from("classes")
      .select("id, subject, teacher_id, is_active, closed_at, is_makeup_pool").eq("tenant_id", tenantId).in("id", chunk));
    const classMap = new Map(classes.map(row => [row.id, row]));
    if (enrollments.some(row => !classMap.has(row.class_id))) throw new Error("Student enrollment class is unavailable");
    const teachers = await fetchInChunks<{ id: string; display_name: string | null }>([...new Set(classes.flatMap(row =>
      !row.is_makeup_pool && (row.subject === "english" || row.subject === "math") && row.teacher_id ? [row.teacher_id] : []))], chunk => admin.from("users")
      .select("id, display_name").eq("tenant_id", tenantId).in("id", chunk));
    const teacherMap = new Map(teachers.map(row => [row.id, row.display_name]));
    const byStudent = new Map<string, BasicEnrollment[]>();
    for (const row of enrollments) {
      const cls = classMap.get(row.class_id)!;
      if (cls.is_makeup_pool || (cls.subject !== "english" && cls.subject !== "math")) continue;
      const list = byStudent.get(row.student_id) ?? [];
      list.push({ subject: cls.subject, startDate: row.start_date, endDate: row.end_date, isTransferred: row.is_transferred === true,
        onHold: row.on_hold === true, classActive: cls.is_active, closedAt: cls.closed_at,
        teacherAssigned: !!cls.teacher_id, teacherName: cls.teacher_id ? teacherMap.get(cls.teacher_id) ?? null : null });
      byStudent.set(row.student_id, list);
    }
    return new Map(ids.map(id => [id, buildStudentBasics(byStudent.get(id) ?? [], asOf, withdrawnByStudent?.get(id))]));
  } catch (error) {
    logDbError(error, "mcs.student-basics", { tenantId });
    return new Map(ids.map(id => [id, unavailableStudentBasics(asOf)]));
  }
}
