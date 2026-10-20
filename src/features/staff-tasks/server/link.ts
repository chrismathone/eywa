import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchInChunks } from "@/lib/supabase/batch";
import { reportError } from "@/lib/observability/report-error";

/**
 * 알림을 보내기 직전에 그 알림이 알릴 할 일 id를 찾는다(0377a) — 먼저 그 종류만 맞춤을 한 번 돌려(기한 날이 된 후속조치 · 놓친 실패를 연다 · 0378a 종류별 함수)
 * 할 일이 반드시 있게 하고, (대상 id · 회차) → 할 일 id를 돌려준다. 실패하면 빈 표 — 알림은 할 일 연결 없이 그대로 나간다.
 */
export async function taskIdsFor(
  admin: SupabaseClient,
  tenantId: string,
  kind: string,
  subjectIds: readonly string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!subjectIds.length) return out;
  try {
    const { error } = await admin.rpc("staff_tasks_sync", { p_tenant: tenantId, p_kinds: [kind] });
    if (error) throw new Error(`할 일 맞춤: ${error.message}`);
    const rows = await fetchInChunks<{ id: string; subject_id: string; cycle: string }>([...new Set(subjectIds)], (ids) =>
      admin.from("staff_tasks").select("id, subject_id, cycle").eq("tenant_id", tenantId).eq("kind", kind).in("subject_id", ids));
    for (const r of rows) out.set(`${r.subject_id}|${r.cycle}`, r.id);
  } catch (error) {
    reportError(error, { scope: "staff-tasks.link", tenantId, kind });
  }
  return out;
}
