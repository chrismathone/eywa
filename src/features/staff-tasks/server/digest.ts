import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { kstToday } from "@/lib/date-kst";
import { notifyUsers } from "@/features/notifications/server/notify";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { taskKindLabel } from "../kinds";
import { hiddenStaffTaskKinds } from "../task-visibility";

/**
 * 늦은 할 일 아침 요약(0377a 3단계) — 매일 아침 알림 점검 cron이 지점마다 한 번. 늦은 할 일이 있을 때만,
 * 업무 처리 현황을 지정받은 사람에게만 알림 한 건(슬랙 규칙으로도 보낼 수 있다 — `staff_task_digest`).
 * 원장 전원 사본은 뺐다 — 원장 2026-10-29 *"나와 관련있는 알림만"*. 지정한 사람이 없을 때만 원장(아무도 모르는 일이 없게).
 * 하루 한 번 = notification_events(지점 · 날짜)로 막는다(같은 날 cron이 두 번 돌아도 한 번).
 */
export async function sendStaffTaskDigest(admin: SupabaseClient, tenantId: string): Promise<number> {
  const settingsPromise = getTenantSettingsByTenantId(tenantId);
  // 세기 전에 원래 기록과 맞춘다 — 밤사이 처리된 일이 '늦음'으로 요약에 실리지 않게(30분 맞춤을 기다리지 않는다).
  const { error: syncError } = await admin.rpc("staff_tasks_sync", { p_tenant: tenantId });
  if (syncError) throw new Error(`요약 전 맞춤: ${syncError.message}`);
  const nowIso = new Date().toISOString();
  const settings = await settingsPromise;
  const hidden = hiddenStaffTaskKinds(settings);
  const late = await fetchAllPaged<{ id: string; kind: string }>((from, to) => {
    let q = admin.from("staff_tasks").select("id, kind")
      .eq("tenant_id", tenantId).eq("status", "open").lt("due_at", nowIso);
    if (hidden.length) q = q.not("kind", "in", `(${hidden.join(",")})`);
    return q.order("id").range(from, to);
  });
  if (!late.length) return 0;

  const links = await fetchInChunks<{ task_id: string; user_id: string }>(late.map((t) => t.id), (ids) =>
    admin.from("staff_task_assignees").select("task_id, user_id").eq("tenant_id", tenantId).in("task_id", ids));
  const monitorIds = settings.permissions.specialAccess.staffTaskMonitorIds ?? [];
  const { data: monitors, error: monitorError } = monitorIds.length
    ? await admin.from("users").select("id").eq("tenant_id", tenantId).eq("status", "active").in("id", monitorIds)
    : { data: [], error: null };
  if (monitorError) throw new Error(`지정한 사람 조회: ${monitorError.message}`);
  let recipients = [...new Set((monitors ?? []).map((u) => u.id as string))];
  if (!recipients.length) {
    const { data: masters, error: masterError } = await admin.from("users").select("id").eq("tenant_id", tenantId).eq("status", "active").eq("system_role", "master");
    if (masterError) throw new Error(`원장 조회: ${masterError.message}`);
    recipients = (masters ?? []).map((u) => u.id as string);
  }
  if (!recipients.length) return 0;
  // 하루 한 번 — 받는 사람이 정해진 뒤에 남긴다(받는 사람이 없던 날 기록만 남아 그날 요약이 막히지 않게).
  const today = kstToday();
  const { data: fresh, error } = await admin.from("notification_events")
    .upsert([{ tenant_id: tenantId, event_type: "staff_task_digest", subject_key: tenantId, bucket: today, seeded: false }],
      { onConflict: "tenant_id,event_type,subject_key,bucket", ignoreDuplicates: true })
    .select("id");
  if (error) throw new Error(`요약 중복 막기: ${error.message}`);
  if (!fresh?.length) return 0;


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
    title: `기한 초과 업무 ${late.length.toLocaleString("ko-KR")}건`,
    body: who ? `${kinds} — ${who}` : kinds,
    link: "/dashboard",
    actorId: null,
  })));
  return late.length;
}
