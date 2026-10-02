import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { mergeScope, sameScope, toSyncRow, workerAutoSyncFromHeartbeats, workerReadyFromHeartbeats, type SyncRequestRow, type SyncScope } from "../classnote-sync";

/**
 * 지금 반 보드 동기화(0313a) — 서버 액션이 쓰는 조회·합치기(동기 export가 있어 `"use server"` 파일 밖에 둔다, [[#119]]).
 * 🔴 admin(service_role)이라 RLS를 우회한다 — **모든 조회에 tenant_id 필터**([[#104]]).
 */
type Admin = ReturnType<typeof createAdminClient>;

const COLS = "id, status, requested_at, started_at, finished_at, result, error, scope, merge_count, next_scope";

/** 표가 없다(0313a 적용 전, [[#95]]) — PostgREST PGRST205 / Postgres 42P01. */
export function isMissingTableError(e: unknown): boolean {
  const o = e && typeof e === "object" ? (e as { code?: unknown; message?: unknown }) : {};
  return o.code === "42P01" || o.code === "PGRST205" || (typeof o.message === "string" && /classnote_sync_requests/.test(o.message) && /does not exist|schema cache/.test(o.message));
}

/** 살아 있는 요청(대기·실행 중) + 마지막으로 끝난 요청. 조회 실패는 throw(호출부가 숨김·거절로 받는다). */
export async function loadSyncRows(admin: Admin, tenantId: string): Promise<{ active: SyncRequestRow | null; latest: SyncRequestRow | null }> {
  const [act, fin] = await Promise.all([
    admin.from("classnote_sync_requests").select(COLS).eq("tenant_id", tenantId).in("status", ["pending", "running"]).limit(1),
    admin
      .from("classnote_sync_requests")
      .select(COLS)
      .eq("tenant_id", tenantId)
      .in("status", ["done", "failed"])
      .order("finished_at", { ascending: false, nullsFirst: false })
      .limit(1),
  ]);
  if (act.error) throw act.error;
  if (fin.error) throw fin.error;
  return {
    active: act.data?.[0] ? toSyncRow(act.data[0] as Record<string, unknown>) : null,
    latest: fin.data?.[0] ? toSyncRow(fin.data[0] as Record<string, unknown>) : null,
  };
}

/**
 * 이 지점 연동 PC의 동기화 준비 상태 — `ready` = 지금 요청을 받을 PC가 있는가 · `autoSync` = 낮 동안 달라진 반을 스스로 맞추는가.
 * 조회 실패 = 둘 다 아니라고 본다(받을 PC를 모르면 '대기 중'을 만들지 않고, 없는 기능을 말하지 않는다).
 */
export async function loadWorkerSyncState(admin: Admin, tenantId: string): Promise<{ ready: boolean; autoSync: boolean }> {
  const { data, error } = await admin.from("classnote_workers").select("last_seen, last_results").eq("tenant_id", tenantId);
  if (error) return { ready: false, autoSync: false };
  const rows = (data ?? []) as { last_seen: string | null; last_results: unknown }[];
  const now = Date.now();
  return { ready: workerReadyFromHeartbeats(rows, now), autoSync: workerAutoSyncFromHeartbeats(rows, now) };
}

/** 이 지점에 지금 요청을 받을 연동 PC가 있는가(조회 실패 = 없다고 본다 — 받을 PC를 모르면 '대기 중'을 만들지 않는다). */
export async function workerAcceptsSyncRequests(admin: Admin, tenantId: string): Promise<boolean> {
  return (await loadWorkerSyncState(admin, tenantId)).ready;
}

/**
 * 살아 있는 요청에 범위를 합친다 — `merge_count` 낙관적 잠금(두 화면이 동시에 합쳐도 한쪽 범위가 안 사라지게 3번까지 다시).
 * - 대기 중 = `scope`에 합친다(이번 실행에 함께 돈다).
 * - 실행 중 = 워커가 scope를 이미 읽었다 → `next_scope`에 합친다. 워커가 끝내는 트랜잭션에서 이 범위로 **새 대기 요청**을
 *   만들어 이어서 돈다(합류한 반이 쿨다운·새벽까지 밀리지 않게 — 2026-09-30 적대 리뷰).
 * @returns 바꿨으면 true
 */
export async function mergeIntoPending(admin: Admin, tenantId: string, active: SyncRequestRow, scope: SyncScope): Promise<boolean> {
  let cur: SyncRequestRow | null = active;
  for (let i = 0; i < 3 && cur && (cur.status === "pending" || cur.status === "running"); i++) {
    const running = cur.status === "running";
    const base = running ? cur.nextScope : cur.scope;
    const next = base ? mergeScope(base, scope) : scope;
    if (base && sameScope(next, base)) return false;
    const { data } = await admin
      .from("classnote_sync_requests")
      .update(running ? { next_scope: next, merge_count: cur.mergeCount + 1 } : { scope: next, merge_count: cur.mergeCount + 1 })
      .eq("tenant_id", tenantId)
      .eq("id", cur.id)
      .eq("status", cur.status)
      .eq("merge_count", cur.mergeCount)
      .select("id");
    if (data?.length) return true;
    cur = (await loadSyncRows(admin, tenantId).catch(() => null))?.active ?? null;
  }
  return false;
}
