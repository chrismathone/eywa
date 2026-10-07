import "server-only";

import { effectiveTeacherId, effectiveTeacherScope } from "@/lib/auth/view-mode";
import { createClient } from "@/lib/supabase/server";
import { fetchInChunks } from "@/lib/supabase/batch";
import { gradeTeacherClassIds } from "@/features/grades/server/teacher-classes";

export async function canEditStudent(studentId: string, subject: string, tenantId: string, classId?: string | null): Promise<boolean> {
  const scope = await effectiveTeacherScope();
  if (!scope) return true;
  const teacherId = await effectiveTeacherId();
  if (!teacherId) return false;
  const ids = await gradeTeacherClassIds(teacherId);
  const supabase = await createClient();
  const matchingClasses = await fetchInChunks<{ id: string }>(ids, (chunk) => supabase.from("classes")
    .select("id").eq("tenant_id", tenantId).eq("subject", subject).in("id", chunk), 50);
  const matchingIds = matchingClasses.map((row) => row.id);
  if (classId && matchingIds.includes(classId)) return true;
  const rows = await fetchInChunks<{ id: string }>(matchingIds, (chunk) => supabase.from("enrollments")
    .select("id").eq("tenant_id", tenantId).eq("student_id", studentId).in("class_id", chunk), 50);
  return rows.length > 0;
}
