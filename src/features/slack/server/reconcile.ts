import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged, fetchAllPagedInChunks } from "@/lib/supabase/batch";

/**
 * 유실 대조 — 인박스 트리거(0298a)는 원본 쓰기를 막지 않으려고 예외를 삼킨다. 그러면 그 사건은 인박스에 없고
 * 발송기는 인박스만 읽으니 **영영 빠진다**(codex 2차 검토). 그래서 cron이 5분마다 최근 30분의 원본(알림·감사로그) 중
 * 켜진 규칙의 키에 해당하는 id를 인박스와 대조해 빠진 것을 다시 넣는다. `dedupe_key`가 있어 두 번 나가지 않는다.
 * 창 끝은 2분 전 — 방금 커밋 중인 행을 "빠졌다"고 오인하지 않게.
 * 🔴 키마다 **그 키가 규칙에 들어온 시각(0300a `key_since`) 이후**만 본다 — 규칙을 만들거나 키를 더한 직후
 *    트리거가 원래 넣지 않았던 과거 30분이 쏟아지지 않게. 규칙을 고쳐도 이미 있던 키의 시각은 그대로라 기준이 밀리지 않는다(codex 3차).
 *    같은 키를 여러 규칙이 가지면 **가장 이른 시각**(트리거는 켜진 규칙 하나라도 그 키를 가지면 넣는다).
 */
const WINDOW_MS = 30 * 60_000;
const SETTLE_MS = 2 * 60_000;

export async function reconcileInbox(tenantId: string, now: Date): Promise<number> {
  const admin = createAdminClient();
  const { data: ruleRows, error: ruleErr } = await admin
    .from("slack_rules")
    .select("source, type_keys, key_since, created_at")
    .eq("tenant_id", tenantId)
    .eq("enabled", true);
  if (ruleErr || !ruleRows?.length) return 0;
  const floor = new Map<string, number>(); // `${source}:${key}` → 그 키가 켜진 규칙에 처음 들어온 시각
  for (const r of ruleRows) {
    const since = (r.key_since as Record<string, string> | null) ?? {};
    for (const k of (r.type_keys as string[]) ?? []) {
      const t = new Date(since[k] ?? (r.created_at as string)).getTime();
      const id = `${r.source}:${k}`;
      floor.set(id, Math.min(floor.get(id) ?? Infinity, t));
    }
  }
  const since = new Date(now.getTime() - WINDOW_MS).toISOString();
  const until = new Date(now.getTime() - SETTLE_MS).toISOString();
  let added = 0;

  for (const [source, table, column] of [
    ["notification", "notifications", "type"],
    ["activity", "audit_logs", "action"],
  ] as const) {
    const keys = [...floor.keys()].filter((k) => k.startsWith(`${source}:`)).map((k) => k.slice(source.length + 1));
    if (keys.length === 0) continue;
    const rows = await fetchAllPagedInChunks<Record<string, string>>(keys, (chunk, from, to) =>
      admin.from(table).select(`id, created_at, ${column}`).eq("tenant_id", tenantId).in(column, chunk).gte("created_at", since).lte("created_at", until).order("id").range(from, to),
    );
    const originals = rows.filter((o) => new Date(o.created_at).getTime() >= (floor.get(`${source}:${o[column]}`) ?? Infinity));
    if (originals.length === 0) continue;
    // 인박스 created_at은 원본과 같은 트랜잭션 시각이라 창을 조금 넓혀 읽는다.
    const seenSince = new Date(now.getTime() - WINDOW_MS - 10 * 60_000).toISOString();
    const seen = await fetchAllPaged<{ source_id: string }>((from, to) =>
      admin.from("slack_inbox").select("source_id").eq("tenant_id", tenantId).eq("source", source).gte("created_at", seenSince).order("id").range(from, to),
    );
    const have = new Set(seen.map((s) => s.source_id));
    const missing = originals.filter((o) => !have.has(o.id));
    for (let i = 0; i < missing.length; i += 200) {
      const { error } = await admin
        .from("slack_inbox")
        .upsert(
          missing.slice(i, i + 200).map((m) => ({ tenant_id: tenantId, source, source_id: m.id })),
          { onConflict: "tenant_id,source,source_id", ignoreDuplicates: true },
        );
      if (!error) added += Math.min(200, missing.length - i);
    }
  }
  return added;
}
