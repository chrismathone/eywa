import "server-only";
import { requireAccess } from "@/lib/auth/require-access";
import { effectiveTeacherId, effectiveTeacherScope } from "@/lib/auth/view-mode";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { kstToday } from "@/lib/date-kst";
import { getTodaySchedule } from "@/features/timetable/server/queries";
import { getTenantSettings } from "@/features/owner/server/queries";
import { subjectLabelRecord } from "@/features/owner/subjects";
import { classroomLayout, type ClassroomSnapshot } from "./model";
import { getUserPermMatrix } from "@/lib/auth/perm-matrix";
import { canAccess } from "@/lib/permissions";
import { reportError } from "@/lib/observability/report-error";
import { attachClassroomAttendance, type PresenceRecord } from "./presence";

export async function loadClassroomPreview(): Promise<ClassroomSnapshot> {
  const user = await requireAccess("dashboard");
  await Promise.all([requireAccess("timetable"), requireAccess("classes")]);
  const db = await createClient();
  const date = kstToday();
  const matrix = await getUserPermMatrix();
  const attendanceAllowed = canAccess(user.systemRole, "attendance", matrix);
  const [rooms, schedule, scope, settings, teacherId, attendance] = await Promise.all([
    fetchAllPaged<{ id: string; name: string; capacity: number | null; archived_at: string | null }>((from, to) =>
      db.from("classrooms").select("id,name,capacity,archived_at").order("name").order("id").range(from, to)),
    getTodaySchedule({ includeStudentIds: true }),
    effectiveTeacherScope({ includeScheduled: true }),
    getTenantSettings(),
    effectiveTeacherId(),
    attendanceAllowed ? fetchAllPaged<PresenceRecord>((from, to) => db.from("attendance_records")
      .select("id,student_id,class_id,session_date,slot_start,status,seat_label,recorded_at")
      .eq("tenant_id", user.tenantId).eq("session_date", date).order("id").range(from, to))
      .catch((error) => { reportError(error, { scope: "classroom-preview.attendance" }); return null; }) : Promise.resolve(null),
  ]);
  // A snapshot crossing midnight must not label yesterday's timetable as today's.
  if (kstToday() !== date) return loadClassroomPreview();
  const ids = scope ? new Set(scope.classIds) : null;
  const layout = classroomLayout(rooms, schedule.filter((s) => !ids || ids.has(s.classId)), !!scope);
  if (attendance) layout.rooms = attachClassroomAttendance(layout.rooms, attendance, date) as typeof layout.rooms;
  return {
    ...layout, date, at: Date.now(), tenantId: user.tenantId,
    scope: `${user.tenantId}:${user.id}:${teacherId ?? "all"}`,
    scoped: !!scope,
    attendanceAvailable: attendance !== null,
    subjects: subjectLabelRecord(settings.operations.subjects),
  };
}
