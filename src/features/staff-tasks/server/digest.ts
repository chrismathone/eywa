import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { kstToday } from "@/lib/date-kst";
import { notifyUsers } from "@/features/notifications/server/notify";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { taskKindLabel } from "../kinds";

/**
 * 늦은 할 일 아침 요약(0377a 3단계) — 매일 아침 알림 점검 cron이 지점마다 한 번. 늦은 할 일이 있을 때만,
 * 원장(재직) + 업무 처리 현황을 지정받은 사람에게 알림 한 건(슬랙 규칙으로도 보낼 수 있다 — `staff_task_digest`).
 * 하루 한 번 = notification_events(지점 · 날짜)로 막는다(같은 날 cron이 두 번 돌아도 한 번).
 */
export async function sendStaffTaskDigest(admin: SupabaseClient, tenantId: string): Promise<number> {
  const nowIso = new Date().toISOString();
  const late = await fetchAllPaged<{ id: string; kind: string }>((from, to) => admin.from("staff_tasks").select("id, kind")
    .eq("tenant_id", tenantId).eq("status", "open").lt("due_at", nowIso).order("id").range(from, to));
  if (!late.length) return 0;

  const today = kstToday();
  const { data: fresh, error } = await admin.from("notification_events")
    .upsert([{ tenant_id: tenantId, event_type: "staff_task_digest", subject_key: tenantId, bucket: today, seeded: false }],
      { onConflict: "tenant_id,event_type,subject_key,bucket", ignoreDuplicates: true })
    .select("id");
  if (error) throw new Error(`요약 중복 막기: ${error.message}`);
  if (!fresh?.length) return 0;

  const [links, settings, masters] = await Promise.all([
    fetchInChunks<{ task_id: string; user_id: string }>(late.map((t) => t.id), (ids) =>
      admin.from("staff_task_assignees").select("task_id, user_id").eq("tenant_id", tenantId).in("task_id", ids)),
    getTenantSettingsByTenantId(tenantId),
    admin.from("users").select("id").eq("tenant_id", tenantId).eq("status", "active").eq("system_role", "master"),
  ]);
  if (masters.error) throw new Error(`원장 조회: ${masters.error.message}`);
  const monitorIds = settings.permissions.specialAccess.staffTaskMonitorIds ?? [];
  const { data: monitors, error: monitorError } = monitorIds.length
    ? await admin.from("users").select("id").eq("tenant_id", tenantId).eq("status", "active").in("id", monitorIds)
    : { data: [], error: null };
  if (monitorError) throw new Error(`지정한 사람 조회: ${monitorError.message}`);
  const recipients = [...new Set([...(masters.data ?? []), ...(monitors ?? [])].map((u) => u.id as string))];
  if (!recipients.length) return 0;

  const perUser = new Map<string, number>();
  for (const l of links) perUser.set(l.user_id, (perUser.get(l.user_id) ?? 0) + 1);
  const { data: people, error: peopleError } = perUser.size
    ? await admin.from("users").select("id, display_name").eq("tenant_id", tenantId).in("id", [...perUser.keys()])
    : { data: [], error: null };
  if (peopleError) throw new Error(`직원 이름: ${peopleError.message}`);
  const nameOf = new Map((people ?? []).map((u) => [u.id as string, ((u.display_name as string | null) ?? "").trim() || "직원"]));
  const byKind = new Map<string, number>();
  for (const t of late) byKind.set(t.kind, (byKind.get(t.kind) ?? 0) + 1);
  const kinds = [...byKind].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${taskKindLabel(k)} ${n}`).join(" · ");
  const ranked = [...perUser].sort((a, b) => b[1] - a[1] || (nameOf.get(a[0]) ?? "").localeCompare(nameOf.get(b[0]) ?? "", "ko"));
  const head = ranked.slice(0, 5).map(([id, n]) => `${nameOf.get(id) ?? "퇴사한 직원"} ${n}`).join(" · ");
  const who = ranked.length > 5 ? `${head} 외 ${ranked.length - 5}명` : head;

  await notifyUsers(recipients.map((recipientId) => ({
    tenantId, recipientId, type: "staff_task_digest" as const,
    title: `늦은 할 일 ${late.length.toLocaleString("ko-KR")}건`,
    body: who ? `${kinds} — ${who}` : kinds,
    link: "/dashboard",
    actorId: null,
  })));
  return late.length;
}
