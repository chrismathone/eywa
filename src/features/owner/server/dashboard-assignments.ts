import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchInChunks } from "@/lib/supabase/batch";
import type { DashboardAssignment } from "@/features/dashboard/layout/types";

export async function validateDashboardAssignments(tenantId: string, assignments: DashboardAssignment[]): Promise<string | null> {
  const ids = assignments.map((a) => a.userId);
  if (new Set(ids).size !== ids.length) return "같은 직원의 배정이 두 번 들어 있습니다";
  if (!ids.length) return null;
  const db = createAdminClient();
  const rows = await fetchInChunks<{ id: string }>(ids, (chunk) => db.from("users").select("id").eq("tenant_id", tenantId).neq("system_role", "student").in("id", chunk));
  const valid = new Set(rows.map((u) => u.id));
  return ids.some((id) => !valid.has(id)) ? "현재 지점의 직원만 대시보드에 배정할 수 있습니다" : null;
}
