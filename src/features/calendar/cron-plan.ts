/**
 * **구글 캘린더 새벽 크론 — 캘린더마다 "가볍게(증분)"냐 "전체"냐** 순수 판정(IO 없음, Vitest).
 *
 * 원장 2026-09-30: *"하루 한번 새벽에 가볍게 돌려 필요하면."* — 평소 반영은 웹훅 + 증분이 하므로, 새벽 크론은
 * ① 알림 채널 열기·갱신 ② **증분 따라잡기**(놓친 알림 메우기, 웹훅과 같은 코드·같은 잠금)만 하고,
 * **전체 임포트는 필요할 때만** 돈다. 이 파일이 그 "필요할 때"의 단일 소스다.
 *
 * 전체로 도는 경우(위에서부터 먼저 걸리는 것):
 * - `manual`         — `?full=1`로 손으로 돌렸다.
 * - `weekly`         — 일요일(KST) 새벽 안전망. 창(과거 30일·미래 400일) **밖으로 옮겨진** 일정은 증분이 못 보고
 *                      전체 임포트만 정리한다. 캘린더 6개 조회 몇 번이라 비용은 0에 가깝다(구글 무료 할당).
 * - `no_state`       — 상태 줄이 없다(한 번도 동기화 안 함).
 * - `never_synced`   — 시작점(`last_synced_at`)이 없거나 읽을 수 없다.
 * - `stale`          — 시작점이 `FULL_STALE_MS`(48시간)보다 오래됐다 — 무슨 일이 있었는지 모른다.
 * - `channel_failed` — 오늘 채널 열기가 실패했다(또는 채널 기능이 꺼져 있다) → 알림을 못 받는다.
 * - `channel_missing`/`channel_expired` — 크론 **전에** 채널이 없었거나 이미 만료돼 있었다 → 그동안 알림이 안 왔다.
 * 그 밖엔 `incremental`. 증분이 실패하면(410 포함 결과 실패) 호출부가 그 캘린더만 전체로 다시 돈다.
 */

export const FULL_STALE_MS = 48 * 3600_000;
/**
 * 새벽 증분의 조회 시작점 하한 — 시작점이 더 최근이어도 **최소 25시간 전부터** 본다. 웹훅 증분은 쓰기 몇 행이
 * 실패해도 시작점을 옮기므로(410 고리 방지), 그 행들을 하루 한 번 다시 보게 하는 여유다(같은 일정을 두 번 받아도
 * 적용은 멱등). 하루 주기(24h) + 여유 1시간.
 */
export const CATCH_UP_FLOOR_MS = 25 * 3600_000;

export type CronPlanReason =
  | "manual"
  | "weekly"
  | "no_state"
  | "never_synced"
  | "stale"
  | "channel_failed"
  | "channel_missing"
  | "channel_expired"
  | "incremental";

export type CronStateLike = {
  last_synced_at: string | null;
  channel_id: string | null;
  channel_expires_at: string | null;
};

export type CronPlan = { mode: "full" | "incremental"; reason: CronPlanReason };

export function planCalendarCron(input: {
  /** 크론이 채널을 손대기 **전** 상태 줄(없으면 null). */
  state: CronStateLike | null;
  /** 이번 크론의 채널 열기·갱신이 이 캘린더에서 실패했거나 채널 기능 자체가 꺼져 있다. */
  channelFailed: boolean;
  forceFull: boolean;
  weekly: boolean;
  now: number;
}): CronPlan {
  const { state, now } = input;
  if (input.forceFull) return { mode: "full", reason: "manual" };
  if (input.weekly) return { mode: "full", reason: "weekly" };
  if (!state) return { mode: "full", reason: "no_state" };
  const last = state.last_synced_at ? Date.parse(state.last_synced_at) : NaN;
  if (!Number.isFinite(last)) return { mode: "full", reason: "never_synced" };
  if (now - last > FULL_STALE_MS) return { mode: "full", reason: "stale" };
  if (input.channelFailed) return { mode: "full", reason: "channel_failed" };
  if (!state.channel_id) return { mode: "full", reason: "channel_missing" };
  const exp = state.channel_expires_at ? Date.parse(state.channel_expires_at) : NaN;
  // 만료 시각을 모르면 만료로 본다(알림이 오고 있었는지 장담할 수 없다).
  if (!Number.isFinite(exp) || exp <= now) return { mode: "full", reason: "channel_expired" };
  return { mode: "incremental", reason: "incremental" };
}

/** 오늘이 주간 전체 임포트 날인가 — KST 일요일(크론 04:00 KST = 토요일 19:00 UTC). */
export function isWeeklyFullDay(now: number): boolean {
  return new Date(now + 9 * 3600_000).getUTCDay() === 0;
}

/** 새벽 증분의 시작점 = 저장된 시작점과 `now - CATCH_UP_FLOOR_MS` 중 **이른 쪽**. */
export function catchUpSince(lastSyncedAt: string | null, now: number): string {
  const floor = now - CATCH_UP_FLOOR_MS;
  const t = lastSyncedAt ? Date.parse(lastSyncedAt) : NaN;
  return new Date(Number.isFinite(t) ? Math.min(t, floor) : floor).toISOString();
}

/** 손으로 돌릴 때 `?full=1`이면 전 캘린더 전체 임포트. */
export function isForceFull(url: string): boolean {
  try {
    return new URL(url).searchParams.get("full") === "1";
  } catch {
    return false;
  }
}
