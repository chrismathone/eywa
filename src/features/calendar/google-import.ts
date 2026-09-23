/**
 * **구글 캘린더 → aywa 한 방향 임포트** — 순수 변환·판정(IO 없음, Vitest).
 *
 * 원장 2026-09-10: *"캘린더 탭은 메뉴에서 제외시켜. 그냥 내부 구글 달력용으로 사용할예정임."* →
 * *"즉, 동기화하지만 외부로 보여주지않고 내부 끌어오기 참고용으로만 할것"* → *"하루 2회 정도, 오전 오후 6시쯤"*.
 *
 * 🔴 **한 방향이다** — aywa는 구글에 한 글자도 안 쓴다. 그래서 결정 로그가 경계하던 split-brain
 *    (양방향 동기화)이 생기지 않는다. 서비스 계정 권한도 읽기(`일정 세부정보 보기`)까지만 받았다.
 * 🔴 **사람이 고친 일정은 덮지 않는다**(원장 확인 필요 항목 중 B안) — `updated_at > google_synced_at`이면
 *    임포트 뒤에 사람이 손댄 것이라 건너뛴다. 안 그러면 화면에서 고친 값이 밤사이 되돌아간다.
 */

/** 구글 일정 한 건에서 우리가 쓰는 부분만. */
export type GoogleEventLike = {
  id?: string | null;
  status?: string | null;
  summary?: string | null;
  description?: string | null;
  location?: string | null;
  start?: { date?: string | null; dateTime?: string | null } | null;
  end?: { date?: string | null; dateTime?: string | null } | null;
};

/** aywa `calendar_events` 한 행으로 넣을 값. */
export type ImportedEventRow = {
  googleEventId: string;
  title: string;
  memo: string | null;
  startDate: string; // YYYY-MM-DD (KST)
  endDate: string; // YYYY-MM-DD (KST, **포함**)
  startTime: string | null; // HH:MM (종일이면 null)
  endTime: string | null;
};

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** ISO 시각 → KST 달력일·시:분. 구글 `dateTime`은 오프셋을 달고 오므로 UTC로 환산한 뒤 +9시간. */
function toKst(iso: string): { date: string; time: string } | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms + KST_OFFSET_MS);
  return {
    date: d.toISOString().slice(0, 10),
    time: d.toISOString().slice(11, 16),
  };
}

/** YYYY-MM-DD에 일수 더하기(달력일 산술). */
export function shiftYmd(ymd: string, days: number): string {
  const ms = Date.parse(`${ymd}T00:00:00Z`);
  if (!Number.isFinite(ms)) return ymd;
  return new Date(ms + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * 제목 없는 일정의 표시 이름 — 구글에서 제목을 비우면 `summary`가 아예 없다.
 * 🔴 빈 문자열로 넣지 않는다 — 목록에서 **투명한 줄**이 되어 "왜 빈 칸이 있지"가 된다.
 * ⚠️ 비공개(private) 일정도 읽기 권한으론 제목이 안 와서 여기로 떨어진다(권한 문제가 아니다).
 */
export const UNTITLED_LABEL = "(제목 없는 일정)";

/**
 * 구글 일정 → aywa 행. 넣을 수 없으면 null(취소됨·id 없음·날짜 없음).
 *
 * 🔴 **종일 일정의 `end.date`는 구글에서 '다음 날'(배타적)이다** — 그대로 넣으면 하루짜리 일정이
 *    이틀로 늘어나 달력에 한 칸 더 칠해진다. 하루 빼서 **포함 끝날**로 바꾼다.
 * ⚠️ 시각 일정의 종료가 없으면(드물다) 시작과 같은 날로 두고 종료시각은 비운다 — 지어내지 않는다.
 */
export function toImportedRow(ev: GoogleEventLike, calendarName: string): ImportedEventRow | null {
  const id = ev.id?.trim();
  if (!id) return null;
  if (ev.status === "cancelled") return null;

  const allDayStart = ev.start?.date ?? null;
  if (allDayStart) {
    const endExclusive = ev.end?.date ?? null;
    // 구글 종일 종료는 배타적 → 하루 빼서 포함 끝날로. 끝이 시작보다 앞서면 하루짜리로 바닥.
    const endInclusive = endExclusive ? shiftYmd(endExclusive, -1) : allDayStart;
    return {
      googleEventId: id,
      title: (ev.summary ?? "").trim() || UNTITLED_LABEL,
      memo: buildMemo(ev, calendarName),
      startDate: allDayStart,
      endDate: endInclusive < allDayStart ? allDayStart : endInclusive,
      startTime: null,
      endTime: null,
    };
  }

  const startIso = ev.start?.dateTime ?? null;
  if (!startIso) return null;
  const s = toKst(startIso);
  if (!s) return null;
  const endIso = ev.end?.dateTime ?? null;
  const e = endIso ? toKst(endIso) : null;
  return {
    googleEventId: id,
    title: (ev.summary ?? "").trim() || UNTITLED_LABEL,
    memo: buildMemo(ev, calendarName),
    startDate: s.date,
    endDate: e ? e.date : s.date,
    startTime: s.time,
    endTime: e ? e.time : null,
  };
}

/** 메모 = 출처 한 줄 + 구글 설명/장소. 출처를 적어 두면 화면에서 "이건 어디서 온 값인가"가 읽힌다. */
function buildMemo(ev: GoogleEventLike, calendarName: string): string | null {
  const parts = [`${IMPORT_MEMO_PREFIX}${calendarName}`];
  const loc = ev.location?.trim();
  if (loc) parts.push(`장소: ${loc}`);
  const desc = stripHtml(ev.description ?? "").trim();
  if (desc) parts.push(desc);
  const memo = parts.join("\n");
  return memo.length > 4000 ? `${memo.slice(0, 4000)}…` : memo;
}

/**
 * 구글 설명의 HTML 제거 — 구글 캘린더 설명은 `<h4><strong>…` 같은 마크업을 그대로 담는다.
 * 9/3 임포트가 이걸 안 벗겨서 메모에 `설명: <h4><strong>&lt; EiE 영어 </strong>` 같은 글자가 남아 있다.
 */
export function stripHtml(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * 이 행을 임포트가 덮어써도 되나 — **사람이 손댄 뒤면 안 된다**(원장 B안).
 *
 * 판정은 `updated_at > google_synced_at`. 임포트는 쓸 때마다 `google_synced_at`을 같이 올리므로,
 * 그보다 `updated_at`이 뒤면 그 사이에 사람이 화면에서 고친 것이다.
 * ⚠️ `google_synced_at`이 없으면(9/3 스냅샷 등 옛 행) **덮어쓸 수 있게** 참을 돌려준다 —
 *    그 행들은 애초에 구글에서 온 값이라 최신 구글 내용으로 맞추는 것이 맞다.
 */
export function canOverwrite(row: { updatedAt: string | null; googleSyncedAt: string | null }): boolean {
  if (!row.googleSyncedAt) return true;
  if (!row.updatedAt) return true;
  const u = Date.parse(row.updatedAt);
  const g = Date.parse(row.googleSyncedAt);
  if (!Number.isFinite(u) || !Number.isFinite(g)) return true;
  // 1초 여유 — 같은 트랜잭션에서 updated_at 트리거가 microsecond 뒤에 찍힐 수 있다.
  return u <= g + 1000;
}

/**
 * 이번 회차에서 **지울 행** — 그 캘린더·그 기간에 우리가 갖고 있는데 구글엔 더 이상 없는 것.
 *
 * 🔴 **손으로 만든 일정은 절대 후보가 아니다** — `googleEventId`가 있는 행만 넘어온다(호출부 쿼리가 좁힌다).
 * 🔴 **구글 조회가 실패하면 부르지 말 것** — 빈 목록을 "구글에서 다 지워졌다"로 읽으면 그 캘린더가 통째로 사라진다.
 *    (조회 실패와 '일정 0건'은 다른 사실이다.)
 */
export function planDeletions(
  existingIds: readonly string[],
  seenIds: ReadonlySet<string>,
): string[] {
  return existingIds.filter((id) => !seenIds.has(id));
}

/**
 * 삭제 묘비 키(F15) — 사람이 aywa에서 지운 구글 일정을 다음 회차가 되살리지 않게, 삭제 감사로그에
 * 이 키를 남기고 임포트가 건너뛴다. 구글 일정 id는 캘린더 안에서만 유일해서 캘린더 id와 묶는다.
 */
export function googleEventKey(calendarId: string, eventId: string): string {
  return `${calendarId}::${eventId}`;
}

export type CalendarSource = { calendarId: string; tagName: string };

/**
 * 대상 캘린더 — env `GOOGLE_CALENDAR_IDS`에 `태그이름|캘린더ID` 한 줄씩(또는 `;`로 구분).
 *
 * 🔴 **코드에 캘린더 ID를 박지 않는다** — 특정 학원의 데이터라 코드에 넣으면 테넌트가 늘 때 못 쓴다.
 * 🔴 **태그는 캘린더 이름에서 파생하지 않는다** — 구글 이름이 `02. 입학 상담_NEW`인데 aywa 태그는
 *    `02. 입학 상담`이라, 이름을 그대로 쓰면 **같은 일이 태그 둘로 갈린다**(셔틀 정류장이 5벌로 갈렸던 함정).
 *    그래서 짝을 명시로 적는다. 구글에서 캘린더 이름을 바꿔도 태그는 안 흔들린다.
 * ⚠️ 값이 없으면 **아무 일도 안 한다**(fail-closed) — 목록을 모르면 삭제 정리를 할 수 없고,
 *    "0건 봤으니 다 지우자"가 되면 최악이다.
 */
export function parseCalendarSources(raw: string | undefined): CalendarSource[] {
  if (!raw?.trim()) return [];
  return raw
    .split(/[\n;]+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const i = line.indexOf("|");
      if (i <= 0) return null;
      const tagName = line.slice(0, i).trim();
      const calendarId = line.slice(i + 1).trim();
      return tagName && calendarId ? { tagName, calendarId } : null;
    })
    .filter((v): v is CalendarSource => v !== null);
}

/**
 * 9/3 **1회성 스냅샷** 행의 메모 접두 — 그 행들은 구글 id가 없어 새 임포트와 짝지을 수 없다.
 *
 * 🔴 첫 회차에 이걸 안 치우면 **겹치는 기간이 두 벌**이 된다(실측 2026-09-10: 창 안 160행).
 *    창 **밖**(과거)의 6,108행은 2016년까지 거슬러 가는 **유일한 기록**이라 절대 건드리지 않는다.
 * 🔴 새 임포트가 쓰는 메모 접두(`구글 캘린더 · `)와 **글자가 다르다** — 그래서 이 정리가
 *    이번 임포트가 방금 넣은 행을 잡아먹는 일은 구조적으로 없다.
 * ⚠️ 손으로 만든 일정은 이 접두가 없으므로 후보가 아니다(실측 창 안 67행 — 전부 보존).
 */
export const LEGACY_SNAPSHOT_MEMO_PREFIX = '구글 캘린더 임포트';

/** 새 임포트가 메모 첫 줄에 쓰는 접두. 위 옛 접두와 겹치면 안 된다(가드가 잠근다). */
export const IMPORT_MEMO_PREFIX = '구글 캘린더 · ';
