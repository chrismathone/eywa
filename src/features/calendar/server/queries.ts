import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { reportError } from "@/lib/observability/report-error";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { normalizeCalendarColor } from "../color";
import { type CalendarEvent, type CalendarTag } from "../types";

/**
 * 캘린더 조회 — 월 단위(그 달과 **겹치는** 일정 전부) + 연 단위(연간/목록/분석 뷰, 0224a).
 * 읽기는 세션 클라이언트 + RLS(테넌트 전원). 쓰기는 서버 액션(actions.ts).
 *
 * ⚠️ #95 expand/contract — SQL은 원장이 손으로 적용하므로 앱이 항상 먼저 배포된다. 전 직원이
 *    보는 화면이라 스키마 세대별 select 폴백 체인으로 살아남는다:
 *    FULL(태그 0224a + 시리즈 0222a) → NO_TAG(0224a 전) → LEGACY(0222a 전) → 표 부재 = ready:false.
 */

export type CalendarMonth = {
  ready: boolean;
  events: CalendarEvent[];
};

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** 그 달의 [1일, 말일] — UTC 산술이라 서버 TZ와 무관. */
export function monthRange(month: string): { first: string; last: string } {
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return { first: `${month}-01`, last: `${month}-${String(lastDay).padStart(2, "0")}` };
}

/**
 * 승인된 휴가 오버레이 — 캘린더에 "누가 언제 쉬는지"를 자동 표시(원장 2026-08-18, 캘린더 도입의 발단).
 *
 * 진실은 결재 문서(leave_forms + approval_documents.status='approved')이고 여기서 **조회 시점에
 * 합성**한다 — 캘린더에 복제 저장하지 않으므로 회수·데이터 정정이 자동 반영된다.
 * ⚠️ admin(RLS 우회)으로 읽는 이유: leave_forms RLS는 문서 관계자(기안자·결재선·참조·원장)만 열어서
 *    세션 클라이언트로는 일반 직원 캘린더에 남의 휴가가 안 뜬다. "누가 언제 쉬는지"는 학원 공용
 *    정보라 의도적으로 우회하되, **이름·기간·종류만** 내보낸다(사유·문서 내용은 안 내려보냄).
 *    tenant_id 명시 필터 필수([[#104]]).
 */
async function approvedLeaveOverlay(first: string, last: string): Promise<CalendarEvent[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("leave_forms")
    .select(
      "document_id, leave_kind, start_date, end_date, doc:approval_documents!leave_forms_document_id_fkey!inner(status), person:users!leave_forms_user_id_fkey(display_name)",
    )
    .eq("tenant_id", user.tenantId)
    .eq("doc.status", "approved")
    .lte("start_date", last)
    .gte("end_date", first)
    .limit(500); // 월당 휴가 수십 건 규모 — 절단 방지 명시 상한(B2)
  if (error || !data) {
    // 오버레이는 부가 정보 — 실패해도 수기 일정은 떠야 한다. 단 조용히 접으면 "휴가가 안 뜬다"를
    // 아무도 모른다([[#89]] 침묵 폴백) → 계측만 남기고 빈 값.
    if (error) reportError(error, { scope: "calendar.leaveOverlay" });
    return [];
  }

  return data.map((r) => {
    const person = r.person as { display_name?: string } | null;
    const kind = r.leave_kind === "half" ? "반차" : r.leave_kind === "quarter" ? "반반차" : "연차";
    return {
      id: `leave-${String(r.document_id)}`,
      title: `${person?.display_name ?? "(이름 없음)"} ${kind}`,
      memo: null,
      startDate: String(r.start_date),
      endDate: String(r.end_date),
      startTime: null,
      endTime: null,
      color: "amber" as const, // 휴가 전용 톤 — 수기 일정과 구분
      createdByName: null,
      source: "leave" as const,
      seriesId: null,
      tag: null,
    };
  });
}

/** 수기 일정 행 — series_id(0222a)·tag(0224a)는 마이그 전 배포에선 없을 수 있다(폴백 체인). */
type ManualEventRow = {
  id: string;
  title: string;
  memo: string | null;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  color: string;
  series_id?: string | null;
  tag?: { id: string; name: string; color: string } | null;
  creator: { display_name?: string } | null;
};

// select 폴백 체인(#95) — i번째가 실패하면 **그 세대가 새로 짚는 컬럼**의 에러일 때만 다음 세대로.
const COLS_FULL =
  "id, title, memo, start_date, end_date, start_time, end_time, color, series_id, tag:calendar_tags!calendar_events_tag_id_fkey(id, name, color), creator:users!calendar_events_created_by_fkey(display_name)";
const COLS_NO_TAG =
  "id, title, memo, start_date, end_date, start_time, end_time, color, series_id, creator:users!calendar_events_created_by_fkey(display_name)";
const COLS_LEGACY =
  "id, title, memo, start_date, end_date, start_time, end_time, color, creator:users!calendar_events_created_by_fkey(display_name)";
const ATTEMPTS: { cols: string; droppedBy: RegExp }[] = [
  { cols: COLS_FULL, droppedBy: /tag_id|calendar_tags/i },
  { cols: COLS_NO_TAG, droppedBy: /series_id/i },
  { cols: COLS_LEGACY, droppedBy: /$^/ },
];

function mapManual(r: ManualEventRow): CalendarEvent {
  const tag: CalendarTag | null = r.tag
    ? {
        id: String(r.tag.id),
        name: String(r.tag.name),
        // 프리셋 키든 사용자 지정 hex든 색 단일 소스가 판정한다(color.ts) — 여기서 프리셋만 통과시키면
        // 원장이 색상 선택기로 고른 hex가 조회 단계에서 네이비로 뭉개진다.
        color: normalizeCalendarColor(r.tag.color),
      }
    : null;
  return {
    id: String(r.id),
    title: String(r.title),
    memo: r.memo ?? null,
    startDate: String(r.start_date),
    endDate: String(r.end_date),
    // DB time은 "HH:MM:SS" — 표시는 분까지.
    startTime: r.start_time ? String(r.start_time).slice(0, 5) : null,
    endTime: r.end_time ? String(r.end_time).slice(0, 5) : null,
    color: normalizeCalendarColor(r.color),
    createdByName: r.creator?.display_name ?? null,
    source: "manual" as const,
    seriesId: r.series_id ? String(r.series_id) : null,
    tag,
  };
}

/**
 * [first, last]와 겹치는 수기 일정 전건 — `.range` 페이지네이션(fetchAllPaged, B2: 1000행 절단 방지.
 * 연간 뷰가 한 해 전체를 읽는다 — 반복 60회 시리즈가 여럿이면 1000을 넘을 수 있다).
 * 표 부재 = ready:false(0218a 전 배포), 그 밖의 실패 = throw(호출부가 한글 배너로).
 */
async function fetchManualEvents(
  first: string,
  last: string,
  opts: { titleContains?: string } = {},
): Promise<{ ready: boolean; events: CalendarEvent[] }> {
  const supabase = await createClient();
  // 제목 검색(N9) — `%`·`_`·`\`는 ilike 와일드카드라 글자 그대로 찾게 이스케이프한다.
  const titlePattern = opts.titleContains
    ? `%${opts.titleContains.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    : null;
  let lastError = "";
  for (const attempt of ATTEMPTS) {
    try {
      const rows = await fetchAllPaged<ManualEventRow>(
        (from, to) => {
          let q = supabase
            .from("calendar_events")
            .select(attempt.cols)
            .lte("start_date", last)
            .gte("end_date", first);
          if (titlePattern) q = q.ilike("title", titlePattern);
          return q
            .order("start_date", { ascending: true })
            .order("id", { ascending: true }) // OFFSET 페이지 흔들림 방지 tie-break
            .range(from, to) as unknown as PromiseLike<{
            data: ManualEventRow[] | null;
            error: { message: string } | null;
          }>;
        },
      );
      return { ready: true, events: rows.map(mapManual) };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      if (/PGRST205|42P01|Could not find the table/i.test(lastError)) {
        return { ready: false, events: [] }; // 0218a 전 — 캘린더 표 자체가 없다
      }
      if (attempt.droppedBy.test(lastError)) continue; // 그 세대 컬럼 부재 — 다음 세대로
      throw new Error(`일정 조회 실패 — ${lastError}`);
    }
  }
  throw new Error(`일정 조회 실패 — ${lastError}`);
}

export async function getMonthEvents(month: string): Promise<CalendarMonth> {
  if (!MONTH_RE.test(month)) return { ready: true, events: [] };
  const { first, last } = monthRange(month);

  // 수기 일정과 휴가 오버레이는 서로 독립 — 병렬(B4).
  const [manual, leaveEvents] = await Promise.all([
    fetchManualEvents(first, last),
    approvedLeaveOverlay(first, last),
  ]);
  if (!manual.ready) return { ready: false, events: [] };

  return {
    ready: true,
    events: [...leaveEvents, ...manual.events].sort((a, b) => a.startDate.localeCompare(b.startDate)),
  };
}

const YEAR_MIN = 2000;
const YEAR_MAX = 2100;
const validYear = (y: number) => Number.isInteger(y) && y >= YEAR_MIN && y <= YEAR_MAX;

/**
 * 다개년 조회(분석 뷰) — 원장 2026-08-19: *"분석인데 해당 년도만 있음. 전년도 후년도까지 한번에."*
 * 연 단위 조회와 같은 규약(**수기 일정만** — 휴가 오버레이는 분석의 축이 아니다). 구간과 겹치는 전부.
 * ⚠️ 범위 밖 연도는 빈 결과 — 호출부(page)가 창을 [2000, 2100]으로 잘라서 넘긴다.
 */
export async function getYearRangeEvents(
  fromYear: number,
  toYear: number,
): Promise<CalendarMonth> {
  if (!validYear(fromYear) || !validYear(toYear) || fromYear > toYear) {
    return { ready: true, events: [] };
  }
  return fetchManualEvents(`${fromYear}-01-01`, `${toYear}-12-31`);
}

const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * 날짜 구간 조회 — **수기 일정만**, [first, last]와 겹치는 전부(연 단위 조회와 같은 규약). 운영실 '레벨테스트 및
 * 첫수업 일정'(오늘부터 한 달, 원장 2026-09-16)이 쓴다 — 달 단위(`getMonthEvents`)로 받으면 창이 두 달에 걸치는 날마다
 * 수기 일정·휴가 오버레이를 두 번씩 읽는데, 휴가는 입학 일정 분류에서 어차피 전부 버려진다(30초 갱신마다 도는 자리).
 * ⚠️ 날짜가 아니거나 거꾸로면 빈 결과.
 */
export async function getDateRangeEvents(first: string, last: string): Promise<CalendarMonth> {
  if (!DATE_RE.test(first) || !DATE_RE.test(last) || first > last) return { ready: true, events: [] };
  return fetchManualEvents(first, last);
}

/**
 * 연 단위 조회(연간/목록 뷰, 0224a) — **수기 일정만**. 휴가 오버레이는 일정 분석의 축이
 * 아니라 의도적으로 뺀다(월 그리드에서만 겹쳐 보인다). 그 해와 겹치는 일정 전부, 날짜순.
 */
export async function getYearEvents(year: number): Promise<CalendarMonth> {
  return getYearRangeEvents(year, year);
}

/** 제목 검색어 상한 — 주소창에서 긴 문자열을 받아도 쿼리를 키우지 않는다. */
export const CALENDAR_QUERY_MAX = 50;

/**
 * 제목으로 찾기(목록 보기 `?q=`, 2026-09-23 전수 점검 N9) — **전체 연도**의 수기 일정에서 제목에 검색어가 든 것.
 * 🔑 한 해로 좁히면 몇 해 전 일정(누적 약 6,500행)을 찾으려고 연도를 하나씩 넘겨야 했다. 페이징(B2)이라 절단 없음.
 * 빈 검색어면 빈 결과(호출부가 연 단위 조회를 쓴다).
 */
export async function searchEventsByTitle(query: string): Promise<CalendarMonth> {
  const q = query.trim().slice(0, CALENDAR_QUERY_MAX);
  if (!q) return { ready: true, events: [] };
  return fetchManualEvents(`${YEAR_MIN}-01-01`, `${YEAR_MAX}-12-31`, { titleContains: q });
}

/**
 * 일정 한 건(목록·연간 보기에서 눌러 여는 다이얼로그용, N9) — 목록 전건에 메모까지 실어 보내지 않으려고
 * 누른 한 건만 읽는다(반응속도). 세션 클라이언트 + RLS(테넌트). 없으면 null.
 */
export async function getCalendarEventById(id: string): Promise<CalendarEvent | null> {
  const supabase = await createClient();
  let lastError = "";
  for (const attempt of ATTEMPTS) {
    const { data, error } = await supabase
      .from("calendar_events")
      .select(attempt.cols)
      .eq("id", id)
      .maybeSingle();
    if (!error) return data ? mapManual(data as unknown as ManualEventRow) : null;
    lastError = error.message;
    if (attempt.droppedBy.test(lastError)) continue;
    break;
  }
  throw new Error(`일정 조회 실패 — ${lastError}`);
}

/**
 * 태그 사전(0224a) — 이름 가나다순(⚠️ Postgres 정렬은 로마자→한글 [[#84]] — JS에서 ko 정렬).
 * 표 부재(0224a 전 배포)·실패 = 빈 배열(태그 UI가 조용히 접힌다, #95 — 일정 자체는 무관).
 */
export async function getCalendarTags(): Promise<CalendarTag[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("calendar_tags").select("id, name, color").limit(200);
  if (error || !data) return [];
  return data
    .map((t) => ({
      id: String(t.id),
      name: String(t.name),
      color: normalizeCalendarColor(t.color),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
}
