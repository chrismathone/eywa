import "server-only";
import { cache } from "react";
import { getCurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import { teacherViewableClassIds, READ_GRACE_DAYS } from "@/features/students/server/read-scope";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { addDays, kstToday } from "@/lib/date-kst";

/** null = 전체, Set = 열람 가능한 원본 학생. 메뉴 허용은 학생 원본의 담당 범위를 넓히지 않는다. */
export const readableFactStudents = cache(async (): Promise<Set<string> | null> => {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return new Set();
  const level = await accessLevelTenant(user.systemRole, "students");
  if (level === "none") return new Set();
  // 열람 전용 강사 보기에서는 scoped가 readonly로 내려가도 대상 강사의 담당 범위를 유지한다.
  if (level !== "scoped" && user.systemRole !== "teacher") return null;
  const classes = await teacherViewableClassIds(user.id), db = createAdminClient();
  const rows = await fetchAllPagedInChunks<{ student_id: string }>(classes, (chunk, a, b) => db.from("enrollments")
    .select("student_id").eq("tenant_id", user.tenantId).in("class_id", chunk)
    .or(`end_date.is.null,end_date.gte.${addDays(kstToday(), -READ_GRACE_DAYS)}`).order("id").range(a, b));
  return new Set(rows.map((r) => r.student_id));
});
