import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { DRIVE_API, type DriveRequest } from "./drive-api";

type Db = ReturnType<typeof createAdminClient>;

/**
 * 올리기 **시작 전** 그 계정의 Drive 남은 공간 확인 — 남은 공간에서 이번 파일을 뺀 값이 문턱 아래면 새 업로드를 열지 않는다.
 * (이미 시작한 업로드의 완료 확인은 이 판정을 지나지 않는다 — 올라간 파일은 끝까지 받는다.)
 *
 * 문턱: 같은 연결의 발송 PC가 하트비트에 적어 둔 값이 있으면 그 값(PC에서 정한 값을 웹이 덮어쓰지 않는다),
 *       없으면 기존 연결 20GB · 지점 계정 `min(1GB, 한도의 10%)`. 한도가 없는 계정(무제한)은 멈추지 않는다.
 * 캐시: `연결:토큰 번호`별 5분. 문턱 근처(2배 안)면 받기 전에 다시 읽는다.
 * 🔴 용량 조회가 실패하면 **직전 판정을 유지**하고, 직전 판정이 없으면 받는다(조회 장애로 접수를 막지 않는다 — 정말 가득 차면 Drive가 거절한다).
 */
const GB = 1024 ** 3;
const TTL_MS = 5 * 60_000;
const NEAR_REFRESH_MS = 20_000;
const WORKER_FRESH_MS = 10 * 60_000;
export const LEGACY_MIN_FREE_BYTES = 20 * GB;

type Entry = { checkedAt: number; limit: number | null; usage: number; threshold: number };
const cache = new Map<string, Entry>();

export type QuotaTarget = { tenantId: string; connectionId: string | null; tokenVersion: number | null };
const keyOf = (target: QuotaTarget): string => (target.connectionId ? `${target.connectionId}:${target.tokenVersion ?? 0}` : `legacy:${target.tenantId}`);

/** 기본 문턱 — 보고받은 값이 없을 때. */
export function defaultMinFreeBytes(connectionId: string | null, limit: number | null): number {
  if (!connectionId) return LEGACY_MIN_FREE_BYTES;
  return limit === null ? 0 : Math.min(GB, limit * 0.1);
}

/**
 * 같은 연결을 쓰는 발송 PC가 최근 하트비트에 적은 문턱(가장 큰 값). 못 읽으면 null(기본식으로).
 * 🔴 **숫자로 적힌 값만** 받는다 — 값이 없거나 null인 것을 0으로 읽지 않는다(`Number(null)`은 0이다).
 *    지점 계정은 PC가 0으로 정할 수 있다(문턱 없음 — 파일이 들어갈 자리만 있으면 받는다). 그 0을 기본 1GB로 바꾸지 않는다.
 *    기존 연결은 PC도 0을 쓰지 않으므로(0 이하는 20GB로 돌아간다) 여기서도 0보다 클 때만 받는다.
 */
async function reportedMinFreeBytes(db: Db, target: QuotaTarget, now: number): Promise<number | null> {
  try {
    const { data, error } = await db.from("classnote_workers").select("last_results")
      .eq("tenant_id", target.tenantId).gte("last_seen", new Date(now - WORKER_FRESH_MS).toISOString()).limit(5);
    if (error || !data) return null;
    let found: number | null = null;
    for (const row of data as { last_results?: { videoArchive?: { connectionId?: unknown }; videoStorage?: { minFreeBytes?: unknown } } | null }[]) {
      const results = row.last_results;
      if (((results?.videoArchive?.connectionId as string | null | undefined) ?? null) !== target.connectionId) continue;
      const raw = results?.videoStorage?.minFreeBytes;
      if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || (raw === 0 && !target.connectionId)) continue;
      found = found === null ? raw : Math.max(found, raw);
    }
    return found;
  } catch { return null; }
}

async function readQuota(db: Db, target: QuotaTarget, request: DriveRequest, now: number): Promise<Entry | null> {
  try {
    const response = await request(`${DRIVE_API}/about?fields=storageQuota(limit,usage)`);
    if (!response.ok) return null;
    const quota = ((await response.json()) as { storageQuota?: { limit?: string; usage?: string } }).storageQuota;
    const limit = quota?.limit === undefined ? null : Number(quota.limit);
    const usage = Number(quota?.usage);
    if (limit !== null && !(Number.isFinite(limit) && Number.isFinite(usage))) return null;
    const threshold = (await reportedMinFreeBytes(db, target, now)) ?? defaultMinFreeBytes(target.connectionId, limit);
    return { checkedAt: now, limit, usage: Number.isFinite(usage) ? usage : 0, threshold };
  } catch { return null; }
}

const fits = (entry: Entry, bytes: number, factor = 1): boolean => entry.limit === null || entry.limit - entry.usage - bytes >= entry.threshold * factor;

/** 이 파일을 받아도 되나. `false` = 그 계정의 남은 공간이 문턱 아래(새 업로드를 열지 않는다). */
export async function videoDriveHasRoom(input: { db: Db; target: QuotaTarget; request: DriveRequest; bytes: number; now?: number }): Promise<boolean> {
  const now = input.now ?? Date.now();
  const key = keyOf(input.target);
  const cached = cache.get(key);
  const fresh = cached && now - cached.checkedAt < TTL_MS;
  // 여유가 넉넉하면 캐시로 답한다. 문턱 근처면(2배 안) 방금 읽은 값이 아닌 한 다시 읽는다.
  if (cached && fresh && (fits(cached, input.bytes, 2) || now - cached.checkedAt < NEAR_REFRESH_MS)) return fits(cached, input.bytes);
  const read = await readQuota(input.db, input.target, input.request, now);
  if (!read) return cached ? fits(cached, input.bytes) : true;
  if (cache.size >= 500 && !cache.has(key)) cache.delete(cache.keys().next().value as string);
  cache.set(key, read);
  return fits(read, input.bytes);
}

/** 테스트 전용 — 캐시 리셋. */
export function _resetVideoDriveQuotaForTest(): void {
  cache.clear();
}
