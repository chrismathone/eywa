/**
 * **구글 캘린더 푸시(웹훅) + 증분 동기화** — 순수 판정(IO 없음, Vitest).
 *
 * 원장 2026-09-30: *"캘린더에서 이벤트 발생할 때마다 동기화 — 주기보다 웹훅같은걸로"* · *"비용 최소화, 없음 더 좋고"*.
 * 구조 = 구글이 "이 캘린더가 바뀌었다"만 알려 주면(푸시 채널) 그 캘린더의 **바뀐 일정만**(updatedMin) 가져와
 * 전체 임포트와 **같은 규칙**(사람이 고친 행 안 덮기 · 지운 행 묘비 · 손으로 만든 일정 불가침)으로 반영한다.
 * 새벽 크론(하루 한 번, cron-plan.ts)이 놓친 알림을 증분으로 메우고, 필요할 때·주 1회만 전체 임포트로 맞춘다.
 *
 * 🔴 syncToken이 아니라 updatedMin을 쓰는 이유: syncToken은 timeMin/timeMax와 같이 못 쓰고(구글 규칙), 창 없이
 *    `singleEvents`로 첫 토큰을 받으면 끝없는 반복 일정이 끝없이 펼쳐진다. updatedMin은 창(과거 30일·미래 400일)과
 *    함께 쓸 수 있고 **그 시각 뒤 지워진 일정도 항상 돌려준다**(구글 문서) — 전체 임포트와 창이 같아진다.
 */

import { secretMatches } from "@/lib/http/secret-compare";
import { toImportedRow, type GoogleEventLike, type ImportedEventRow } from "./google-import";

/** 저장된 채널 한 줄(검증에 필요한 부분). */
export type StoredChannel = { channelId: string; channelToken: string; resourceId: string | null };

export type PushHeaders = {
  channelId: string | null;
  channelToken: string | null;
  resourceId: string | null;
  resourceState: string | null;
};

/**
 * 구글 푸시 요청이 **우리가 만든 그 채널**에서 왔나. 🔴 웹훅은 공개 주소라 누구나 두드릴 수 있다 —
 * 채널마다 무작위 토큰을 두고 상수시간으로 비교한다. 리소스 id가 저장돼 있으면 그것도 맞아야 한다.
 */
export function verifyPushHeaders(h: PushHeaders, stored: StoredChannel | null): boolean {
  if (!stored || !h.channelId || h.channelId !== stored.channelId) return false;
  if (!secretMatches(h.channelToken, stored.channelToken)) return false;
  if (stored.resourceId && h.resourceId !== stored.resourceId) return false;
  return true;
}

/** 이 알림으로 동기화를 돌려야 하나 — 채널을 연 직후의 `sync` 인사는 변경이 아니다. */
export function isChangeNotification(state: string | null): boolean {
  return state === "exists" || state === "not_exists";
}

/** 채널을 새로 만들어야 하나 — 없거나, 만료가 `marginMs` 안으로 다가왔으면. (새벽 크론이 하루 한 번 본다 — 여유 36시간 > 주기 24시간.) */
export function needsChannelRenewal(expiresAt: string | null, now: number, marginMs = 36 * 3600_000): boolean {
  if (!expiresAt) return true;
  const t = Date.parse(expiresAt);
  if (!Number.isFinite(t)) return true;
  return t - now <= marginMs;
}

/**
 * 증분 조회의 시작점. 🔴 지난 동기화 시각에서 **여유를 두고 뒤로** — 구글 `updated`와 우리 시계가 어긋나거나
 * 조회 도중 바뀐 일정을 놓치지 않게(같은 일정을 두 번 받아도 적용은 멱등이다). 기록이 없으면 하루 전
 * (새벽 크론이 하루 한 번 따라잡는다).
 */
export function incrementalSince(lastSyncedAt: string | null, now: number, slackMs = 5 * 60_000): string {
  const t = lastSyncedAt ? Date.parse(lastSyncedAt) : NaN;
  const base = Number.isFinite(t) ? t - slackMs : now - 24 * 3600_000;
  return new Date(base).toISOString();
}

/**
 * 바뀐 일정 목록 → **넣거나 고칠 행** / **지울 구글 id**. 취소된 일정(`status: cancelled`)은 지울 목록으로.
 * 넣을 수 없는 일정(날짜 없음 등)은 둘 다 아니다 — 모르는 것을 지우지 않는다.
 */
export function splitChanges(
  events: readonly GoogleEventLike[],
  calendarName: string,
): { rows: ImportedEventRow[]; cancelledIds: string[] } {
  const rows: ImportedEventRow[] = [];
  const cancelledIds: string[] = [];
  for (const ev of events) {
    const id = ev.id?.trim();
    if (!id) continue;
    if (ev.status === "cancelled") {
      cancelledIds.push(id);
      continue;
    }
    const row = toImportedRow(ev, calendarName);
    if (row) rows.push(row);
  }
  return { rows, cancelledIds };
}

/**
 * 반복 일정 **시리즈 전체 삭제**(또는 "이후 모든 일정" 수정)는 구글이 회차가 아니라 **원본(master) id 하나**만
 * 취소로 돌려줄 수 있다. 우리 표는 회차 id(`원본id_20261001T…`)로 저장하므로, 원본 id가 정확히 안 맞으면
 * `원본id_`로 시작하는 회차들이 그 시리즈다. 🔴 접두는 **밑줄까지** 붙여 비교한다(`abc`가 `abcd_…`를 잡지 않게).
 */
export function seriesInstanceIds(
  masterId: string,
  candidateIds: readonly string[],
  keep: ReadonlySet<string> = new Set(),
): string[] {
  const prefix = `${masterId}_`;
  return candidateIds.filter(
    (id) =>
      id.startsWith(prefix) &&
      // 🔴 "이후 모든 일정" 수정은 새 시리즈를 만든다 — 새 id가 `원본id_R20261001T…`라 같은 접두에 걸린다.
      //    `_` 다음이 `R`이면 **살아 있는 새 시리즈**다(지우면 최대 12시간 사라진다).
      id.charAt(prefix.length) !== "R" &&
      // 이번 회차에 방금 넣거나 고친 행은 지우지 않는다(삭제가 반영 뒤에 돈다).
      !keep.has(id),
  );
}

/** LIKE 패턴에 넣어도 안전한 구글 id인가(원본 id는 영숫자뿐 — `%`·`,` 같은 글자가 섞이면 쓰지 않는다). */
export function isPlainEventId(id: string): boolean {
  return /^[A-Za-z0-9]{5,1024}$/.test(id);
}

/** 구글이 증분 조회를 거절했나(410 Gone — 시작점이 너무 오래됨). 이때는 전체 임포트로 맞춘다. */
export function isGoneError(e: unknown): boolean {
  const o = e as { code?: unknown; status?: unknown; response?: { status?: unknown } } | null;
  return o?.code === 410 || o?.status === 410 || o?.response?.status === 410;
}

/** 동시 실행 잠금이 풀린 것으로 볼 시간 — 한 회차가 이보다 오래 걸리면 죽은 것으로 본다. */
export const RUN_LOCK_STALE_MS = 5 * 60_000;
