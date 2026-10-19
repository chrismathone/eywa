import "server-only";
import { getCurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { teacherClassScopeStrict, READ_GRACE_DAYS } from "@/features/students/server/read-scope";
import { addDays, kstToday } from "@/lib/date-kst";

/** Sensitive aggregate: scope lookup failures must fail closed, even when an older detail reader falls back. */
export async function careAccess(studentId: string) {
  const user = await getCurrentUser({ teacherView: true });
  if (!user || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(studentId)) return null;
  const studentAccess = await accessLevelTenant(user.systemRole, "students");
  if (studentAccess === "none") return null;
  const teacherId = (await effectiveTeacherId()) ?? (studentAccess === "scoped" ? user.id : null);
  const db = await createClient();
  if (teacherId) {
    const scope = await teacherClassScopeStrict(teacherId);
    const classes = [...new Set([...scope.own, ...scope.slots.map((r) => r.classId), ...scope.delegated])];
    const visible = await fetchAllPagedInChunks<{ id: string }>(classes, (part, from, to) => db.from("enrollments")
      .select("id").eq("tenant_id", user.tenantId).eq("student_id", studentId).in("class_id", part)
      .or(`end_date.is.null,end_date.gte.${addDays(kstToday(), -READ_GRACE_DAYS)}`).order("id").range(from, to));
    if (!visible.length) return null;
  }
  const { data, error } = await db.from("students").select("id, enrolled_at")
    .eq("tenant_id", user.tenantId).eq("id", studentId).maybeSingle();
  if (error) throw new Error("학생 관리 자료의 열람 범위를 확인하지 못했습니다.");
  if (!data) return null;
  const [billing, consultations] = await Promise.all([
    accessLevelTenant(user.systemRole, "billing"), accessLevelTenant(user.systemRole, "consultations"),
  ]);
  return { user, db, teacherId, counselorId: teacherId ?? (consultations === "scoped" ? user.id : null),
    student: data as { id: string; enrolled_at: string | null },
    canReadBilling: billing !== "none", canReadConsultations: consultations !== "none",
    canWriteConsultation: consultations === "full" || consultations === "scoped" };
}
