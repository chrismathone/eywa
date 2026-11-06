import "server-only";
import { getCurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import { teacherViewableClassIds, READ_GRACE_DAYS } from "@/features/students/server/read-scope";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { addDays, kstToday } from "@/lib/date-kst";

/** 기존 학생 상세와 같은 담임·교시·위임 범위. 새 약속 업무에서는 조회 실패 시 처리를 중단한다. */
export async function visibleCareStudents(ids: string[]): Promise<Set<string>> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return new Set();
  if ((await accessLevelTenant(user.systemRole, "students")) !== "scoped") return new Set(ids);
  if (!ids.length) return new Set();
  const classes = await teacherViewableClassIds(user.id);
  const client = await createClient();
  const visible = new Set<string>();
  for (let i = 0; i < classes.length; i += 100) {
    const rows = await fetchAllPaged<{ student_id: string }>((from, to) => client.from("enrollments").select("student_id")
      .eq("tenant_id", user.tenantId).in("student_id", ids).in("class_id", classes.slice(i, i + 100))
      .or(`end_date.is.null,end_date.gte.${addDays(kstToday(), -READ_GRACE_DAYS)}`).order("id").range(from, to));
    for (const row of rows) visible.add(row.student_id);
  }
  return visible;
}
