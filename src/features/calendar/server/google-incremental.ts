import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchInChunks } from "@/lib/supabase/batch";
import { parseCalendarSources, type GoogleEventLike } from "../google-import";
import { incrementalSince, isGoneError, isPlainEventId, seriesInstanceIds, splitChanges } from "../google-push";
import {
  EXISTING_COLUMNS,
  applyRows,
  calendarApi,
  deleteByGoogleIds,
  emptySummary,
  loadTombstones,
  logSyncAudit,
  resolveTagId,
  syncWindow,
  writeFailureCollector,
  type Admin,
  type ExistingRow,
  type ImportSummary,
} from "./google-sync-core";
import { runCalendarFullImportLocked } from "./google-import";
import { acquireLock, unlock, type SyncStateRow } from "./sync-state";

/**
 * **증분 동기화** — 웹훅이 "이 캘린더가 바뀌었다"고 알려 오면 그 캘린더의 **바뀐 일정만** 받아 반영한다.
 * 규칙은 전체 임포트와 한 벌(google-sync-core.ts) — 사람이 고친 행 안 덮음 · 지운 행 묘비 · 손으로 만든 일정 불가침.
 *
 * 🔴 한 캘린더에 한 회차만(잠금 — 하루 2회 전체 임포트도 같은 잠금을 지난다). 도는 동안 알림이 또 오면 `dirty`만
 *    세우고, 끝날 때 한 번 더 돈다(최대 3회 — 그래도 남으면 표식이 남아 다음 알림·전체 임포트가 맞춘다).
 * 🔴 조회가 실패하면 **아무것도 지우지 않는다**(시작점도 안 옮긴다 — 다음 알림·전체 임포트가 다시 본다).
 * 🔴 조회에 **성공했으면** 몇 행 쓰기가 실패해도 시작점은 옮긴다 — 안 옮기면 한 행이 계속 실패할 때 시작점이 굳어
 *    결국 구글이 410(너무 오래됨)을 주고, 알림마다 전체 임포트가 돌다 또 실패하는 고리가 된다. 못 쓴 행은 하루 2회
 *    전체 임포트가 다시 맞춘다.
 * 🔴 **바뀐 게 0건이면 시작점을 옮기지 않는다** — 구글이 알림을 목록 반영보다 먼저 보낼 수 있어서, 옮기면 그 변경을
 *    영영 건너뛴다(다음 알림이 같은 구간을 다시 본다 · 같은 일정을 두 번 받아도 적용은 멱등).
 * 🔴 구글이 410(시작점이 너무 오래됨)으로 거절하면 그 캘린더만 전체 임포트로 맞춘다.
 * ⚠️ env(`GOOGLE_CALENDAR_IDS`)에서 빠진 캘린더의 채널은 다음 크론의 `ensureCalendarChannels`가 닫는다.
 */
export async function runGoogleCalendarIncremental(tenantId: string, state: SyncStateRow): Promise<ImportSummary | null> {
  const src = parseCalendarSources(process.env.GOOGLE_CALENDAR_IDS).find((s) => s.calendarId === state.calendar_id);
  if (!src) return null;
  const admin = createAdminClient();
  let lock = await acquireLock(admin, tenantId, src.calendarId);
  if (lock.status !== "locked") return null;

  let last: ImportSummary | null = null;
  let lastSynced = state.last_synced_at;
  try {
    for (let round = 0; round < 3; round += 1) {
      const startedAt = new Date().toISOString();
      const result = await syncOnce(admin, tenantId, src, lastSynced);
      last = result.summary;
      const advanceTo = result.advance ? startedAt : null;
      if (advanceTo) lastSynced = advanceTo;
      const again = await unlock(admin, tenantId, src.calendarId, lock.token, advanceTo);
      if (!again || !result.ok) break;
      lock = await acquireLock(admin, tenantId, src.calendarId);
      if (lock.status !== "locked") break;
    }
  } catch (e) {
    if (lock.status === "locked") await unlock(admin, tenantId, src.calendarId, lock.token, null).catch(() => false);
    throw e;
  }
  return last;
}

/** 원본 id만 취소로 온 반복 시리즈 → 우리 표의 회차 id들. 이미 정확히 맞은 id는 건너뛴다. */
async function expandCancelledSeries(
  admin: Admin,
  tenantId: string,
  calendarId: string,
  cancelledIds: readonly string[],
  exact: ReadonlyMap<string, ExistingRow>,
  keep: ReadonlySet<string>,
): Promise<string[]> {
  const out: string[] = [];
  for (const id of cancelledIds) {
    if (exact.has(id) || !isPlainEventId(id)) continue;
    // `_`는 LIKE에서 한 글자 자리표시라 넓게 잡힌다 — 받아 온 뒤 JS에서 **밑줄까지** 정확히 거른다.
    const { data, error } = await admin
      .from("calendar_events")
      .select("google_event_id")
      .eq("tenant_id", tenantId)
      .eq("google_calendar_id", calendarId)
      .like("google_event_id", `${id}_%`)
      .limit(1000);
    if (error) throw new Error(`반복 일정 회차 조회 실패: ${error.message}`);
    const ids = (data ?? []).map((r) => String((r as { google_event_id: string | null }).google_event_id ?? ""));
    out.push(...seriesInstanceIds(id, ids, keep));
  }
  return out;
}

async function syncOnce(
  admin: Admin,
  tenantId: string,
  src: { calendarId: string; tagName: string },
  lastSyncedAt: string | null,
): Promise<{ ok: boolean; advance: boolean; summary: ImportSummary }> {
  const summary = emptySummary(tenantId, 1);
  const api = calendarApi();
  if (!api.ok) {
    summary.failed.push({ calendarId: src.calendarId, reason: api.reason });
    return { ok: false, advance: false, summary };
  }
  const now = Date.now();
  const { windowStart, windowEnd } = syncWindow(now);

  let events: GoogleEventLike[];
  try {
    const collected: GoogleEventLike[] = [];
    let pageToken: string | undefined;
    do {
      const res = await api.cal.events.list({
        calendarId: src.calendarId,
        timeMin: windowStart.toISOString(),
        timeMax: windowEnd.toISOString(),
        // 전체 임포트와 같은 모양(회차별로 펼침). updatedMin을 주면 그 뒤 지워진 일정도 항상 온다(구글 규칙).
        singleEvents: true,
        updatedMin: incrementalSince(lastSyncedAt, now),
        maxResults: 2500,
        pageToken,
      });
      collected.push(...((res.data.items ?? []) as GoogleEventLike[]));
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
    events = collected;
  } catch (e) {
    if (isGoneError(e)) {
      // 잠금은 이미 내가 쥐고 있다 — 잠금 없이 그 캘린더만 전체로 맞춘다(시작점은 여기 반환값으로 옮긴다).
      const full = await runCalendarFullImportLocked(admin, tenantId, src);
      return { ok: full.summary.failed.length === 0, advance: full.listed, summary: full.summary };
    }
    summary.failed.push({ calendarId: src.calendarId, reason: e instanceof Error ? e.message.slice(0, 200) : "조회 실패" });
    return { ok: false, advance: false, summary };
  }
  if (events.length === 0) return { ok: true, advance: false, summary };

  const { rows, cancelledIds } = splitChanges(events, src.tagName);
  const ids = [...new Set([...rows.map((r) => r.googleEventId), ...cancelledIds])];
  let existing: ExistingRow[];
  let seriesIds: string[];
  try {
    existing = await fetchInChunks<ExistingRow>(ids, (chunk) =>
      admin
        .from("calendar_events")
        .select(EXISTING_COLUMNS)
        .eq("tenant_id", tenantId)
        .eq("google_calendar_id", src.calendarId)
        .in("google_event_id", chunk),
    );
    const exact = new Map(existing.filter((r) => r.google_event_id).map((r) => [r.google_event_id as string, r]));
    seriesIds = await expandCancelledSeries(admin, tenantId, src.calendarId, cancelledIds, exact, new Set(rows.map((r) => r.googleEventId)));
  } catch (e) {
    summary.failed.push({ calendarId: src.calendarId, reason: `기존 일정 조회 실패 — ${e instanceof Error ? e.message.slice(0, 160) : "조회 실패"}` });
    return { ok: false, advance: false, summary };
  }
  const byGoogleId = new Map(existing.filter((r) => r.google_event_id).map((r) => [r.google_event_id as string, r]));
  const tombstones = await loadTombstones(admin, tenantId, now, summary);
  const tagId = await resolveTagId(admin, tenantId, src.tagName);

  const failures = writeFailureCollector();
  await applyRows(admin, { tenantId, calendarId: src.calendarId, tagId, syncedAt: new Date().toISOString() }, rows, byGoogleId, tombstones, summary, failures.note);
  // 취소 = 정확히 맞은 회차 + 원본 id만 온 시리즈의 회차들. 지우는 규칙은 전체 임포트의 정리와 같다(구글 행만·이 캘린더만).
  await deleteByGoogleIds(admin, tenantId, src.calendarId, [...new Set([...cancelledIds, ...seriesIds])], summary, failures.note);
  failures.flush(summary, src.calendarId);

  await logSyncAudit(admin, summary, "push", { changes: events.length });
  return { ok: summary.failed.length === 0, advance: true, summary };
}
