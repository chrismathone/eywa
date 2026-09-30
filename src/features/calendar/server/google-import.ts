import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import {
  planDeletions,
  LEGACY_SNAPSHOT_MEMO_PREFIX,
  parseCalendarSources,
  toImportedRow,
  type CalendarSource,
  type GoogleEventLike,
  type ImportedEventRow,
} from "../google-import";
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
  type CalendarApi,
  type ExistingRow,
  type ImportSummary,
} from "./google-sync-core";
import { acquireLock, unlock } from "./sync-state";

export type { ImportSummary } from "./google-sync-core";

/**
 * **구글 캘린더 → aywa 한 방향 전체 임포트**(IO). 순수 변환·판정은 [`google-import.ts`](../google-import.ts),
 * 행 반영 규칙은 [`google-sync-core.ts`](./google-sync-core.ts)(웹훅 증분 동기화와 한 벌).
 *
 * 원장 2026-09-10: *"동기화하지만 외부로 보여주지않고 내부 끌어오기 참고용으로만 할것"* + 하루 2회(06:00·18:00 KST).
 * 2026-09-30부터 평소 반영은 **웹훅 + 증분**(google-incremental.ts)이 하고, 이 전체 임포트는 알림을 놓쳤을 때·창 밖으로
 * 옮겨진 일정 정리의 안전망이다.
 *
 * 🔴 **읽기만 한다** — 구글에 쓰지 않는다(서비스 계정 권한도 `일정 세부정보 보기`까지만 받았다).
 * 🔴 **손으로 만든 일정은 절대 안 건드린다** — 모든 쓰기·삭제가 `google_event_id is not null`로 좁혀진다.
 * 🔴 **조회 실패한 캘린더는 삭제 정리를 건너뛴다** — 빈 목록을 "구글에서 다 지워졌다"로 읽으면 그 캘린더가
 *    통째로 사라진다(조회 실패와 '일정 0건'은 다른 사실이다).
 * 🔴 **캘린더마다 웹훅 증분과 같은 잠금을 잡는다** — 둘이 겹치면 같은 일정을 동시에 넣으려다 한쪽이 유일 인덱스
 *    (`calendar_events_google_uniq`, 운영 DB에 있음)에 막혀 그 회차가 실패로 남는다.
 * ⚠️ admin 클라이언트 = RLS 우회 → 모든 쿼리에 **tenant_id 명시 필터**.
 */
export async function runGoogleCalendarImport(tenantId: string): Promise<ImportSummary> {
  const sources = parseCalendarSources(process.env.GOOGLE_CALENDAR_IDS);
  const api = calendarApi();
  const summary = emptySummary(tenantId, sources.length);
  if (sources.length === 0 || !api.ok) {
    summary.failed.push({
      calendarId: "-",
      reason:
        sources.length === 0
          ? "GOOGLE_CALENDAR_IDS 미설정 — `태그이름|캘린더ID` 줄바꿈 구분으로 넣으세요."
          : api.ok
            ? "알 수 없음"
            : api.reason,
    });
    return summary;
  }
  const admin = createAdminClient();
  const now = Date.now();
  const tombstones = await loadTombstones(admin, tenantId, now, summary);

  for (const src of sources) {
    // 🔴 캘린더 하나의 잠금 오류(일시적 DB 오류)가 크론 전체를 500으로 만들지 않게 — 그 캘린더만 실패로 적고 넘어간다
    //    (뒤의 알림 채널 갱신도 그대로 돈다).
    try {
      // 증분이 돌고 있으면 잠깐(최대 ~20초) 기다린다. 그래도 못 잡으면 이 캘린더는 이번 회차를 건너뛴다(다음 회차가 맞춘다).
      let lock = await acquireLock(admin, tenantId, src.calendarId);
      for (let i = 0; lock.status === "deferred" && i < 4; i += 1) {
        await new Promise((r) => setTimeout(r, 5000));
        lock = await acquireLock(admin, tenantId, src.calendarId);
      }
      if (lock.status === "deferred") {
        summary.failed.push({ calendarId: src.calendarId, reason: "알림 동기화가 도는 중이라 이번 회차는 건너뜀(다음 회차에 맞춤)" });
        continue;
      }
      // 증분 동기화의 다음 시작점 — 조회 **직전** 시각(조회 도중 바뀐 일정은 다음 증분이 받는다).
      const startedAt = new Date().toISOString();
      let clean = false;
      try {
        clean = (await importOneCalendar(admin, api.cal, tenantId, src, tombstones, summary, now)).clean;
      } finally {
        // 표가 없으면(SQL 전) 잠금도 시작점도 없다 — 종전 그대로 임포트만.
        if (lock.status === "locked") {
          await unlock(admin, tenantId, src.calendarId, lock.token, clean ? startedAt : null).catch(() => false);
        }
      }
    } catch (e) {
      summary.failed.push({
        calendarId: src.calendarId,
        reason: `동기화 잠금 실패 — ${e instanceof Error ? e.message.slice(0, 160) : "알 수 없음"}`,
      });
    }
  }

  await logSyncAudit(admin, summary, "full");
  return summary;
}

/**
 * 웹훅 증분이 구글에 410(시작점이 너무 오래됨)을 받았을 때 — **이미 잠금을 쥔 채** 그 캘린더만 전체로 맞춘다.
 * (여기서 잠금을 다시 잡으면 자기 잠금에 막힌다.) 시작점 전진·잠금 풀기는 호출부가 한다.
 */
export async function runCalendarFullImportLocked(
  admin: Admin,
  tenantId: string,
  src: CalendarSource,
): Promise<{ summary: ImportSummary; listed: boolean }> {
  const summary = emptySummary(tenantId, 1);
  const api = calendarApi();
  if (!api.ok) {
    summary.failed.push({ calendarId: src.calendarId, reason: api.reason });
    return { summary, listed: false };
  }
  const now = Date.now();
  const tombstones = await loadTombstones(admin, tenantId, now, summary);
  const res = await importOneCalendar(admin, api.cal, tenantId, src, tombstones, summary, now);
  await logSyncAudit(admin, summary, "full", { fallback: "increment_gone" });
  // 조회에 성공했으면 시작점을 옮긴다(쓰기 실패 행은 다음 전체 임포트가 맞춘다) — 410 고리를 끊는다.
  return { summary, listed: res.listed };
}

/**
 * 캘린더 하나 전체 반영. `listed` = 구글 조회 성공(삭제 정리까지 돈 것) · `clean` = 쓰기 실패까지 0.
 * 하루 2회 크론은 `clean`일 때만 시작점을 옮기고, 410 폴백은 `listed`면 옮긴다(굳으면 고리가 된다).
 */
async function importOneCalendar(
  admin: Admin,
  cal: CalendarApi,
  tenantId: string,
  src: CalendarSource,
  tombstones: ReadonlySet<string>,
  summary: ImportSummary,
  now: number,
): Promise<{ listed: boolean; clean: boolean }> {
  const { windowStart, windowEnd, startYmd, endYmd } = syncWindow(now);
  let events: GoogleEventLike[];
  try {
    const collected: GoogleEventLike[] = [];
    let pageToken: string | undefined;
    do {
      const res = await cal.events.list({
        calendarId: src.calendarId,
        timeMin: windowStart.toISOString(),
        timeMax: windowEnd.toISOString(),
        // 반복 일정을 **회차별로 펼친다** — 그래야 각 회차가 제 날짜에 서고 id도 회차마다 다르다.
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 2500,
        pageToken,
      });
      collected.push(...((res.data.items ?? []) as GoogleEventLike[]));
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
    events = collected;
  } catch (e) {
    // 🔴 이 캘린더는 **손도 대지 않고** 넘어간다(삭제 정리 포함).
    summary.failed.push({ calendarId: src.calendarId, reason: e instanceof Error ? e.message.slice(0, 200) : "조회 실패" });
    return { listed: false, clean: false };
  }

  const tagId = await resolveTagId(admin, tenantId, src.tagName);
  const rows = events.map((ev) => toImportedRow(ev, src.tagName)).filter((r): r is ImportedEventRow => r !== null);
  const seen = new Set(rows.map((r) => r.googleEventId));

  // 🔴 페이징(2026-09-23 전수 점검 T2) — 창 안 행이 1,000을 넘으면(실측 1,077) 잘린 꼬리가 "없는 행"으로
  //    읽혀 새 일정으로 **중복 삽입**됐다(B2). 못 읽으면 이 캘린더는 손대지 않는다(삽입·삭제 둘 다).
  let existing: ExistingRow[];
  try {
    existing = await fetchAllPaged<ExistingRow>((from, to) =>
      admin
        .from("calendar_events")
        .select(EXISTING_COLUMNS)
        .eq("tenant_id", tenantId)
        .eq("google_calendar_id", src.calendarId)
        .gte("start_date", startYmd)
        .lte("start_date", endYmd)
        .order("id", { ascending: true })
        .range(from, to),
    );
  } catch (e) {
    summary.failed.push({
      calendarId: src.calendarId,
      reason: `기존 일정 조회 실패 — ${e instanceof Error ? e.message.slice(0, 160) : "조회 실패"}`,
    });
    return { listed: false, clean: false };
  }
  const byGoogleId = new Map(existing.filter((r) => r.google_event_id).map((r) => [r.google_event_id as string, r]));

  // 🔴 첫 회차 정리 — 9/3 스냅샷이 남긴 **구글 id 없는** 같은 태그·같은 기간 행을 치운다.
  //    안 치우면 겹치는 기간이 두 벌이 된다(실측 창 안 160행). 창 밖 과거 6,108행은 2016년까지
  //    거슬러 가는 유일한 기록이라 손대지 않는다(쿼리가 창으로 좁혀져 있다). 2회차부터는 대상 0건.
  if (tagId) {
    await admin
      .from("calendar_events")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("tag_id", tagId)
      .is("google_event_id", null)
      .like("memo", `${LEGACY_SNAPSHOT_MEMO_PREFIX}%`)
      .gte("start_date", startYmd)
      .lte("start_date", endYmd);
  }

  const failures = writeFailureCollector();
  const syncedAt = new Date().toISOString();
  await applyRows(admin, { tenantId, calendarId: src.calendarId, tagId, syncedAt }, rows, byGoogleId, tombstones, summary, failures.note);
  // 구글에서 사라진 회차 정리 — **이 캘린더에서 온 행만**, 창 안에서만.
  await deleteByGoogleIds(admin, tenantId, src.calendarId, planDeletions([...byGoogleId.keys()], seen), summary, failures.note);
  failures.flush(summary, src.calendarId);
  return { listed: true, clean: failures.count === 0 };
}
