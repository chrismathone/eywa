/**
 * KST(Asia/Seoul) "오늘"/"이번 달" 헬퍼 — 서버가 UTC(Vercel)라 `new Date().toISOString().slice(0,10)`은
 * 00:00–09:00 KST 구간에 **하루 전**으로 계산된다(키오스크 체크인·녹음 파일명은 이미 KST라 불일치).
 * 비즈니스 "오늘"이 필요한 곳(대시보드 월/오늘, 시간표 today, 출석/생성 기본일 등)은 이 헬퍼를 쓴다.
 *
 * ⚠️ server-only 금지 — 클라(날짜 input 기본값 등)도 import. ⚠️ 결정적 UTC 날짜 산술(week.ts parse/fmt,
 * 이미 주어진 날짜의 range 계산)에는 쓰지 말 것(거긴 UTC 기준이 정답).
 */

/** KST 기준 오늘(YYYY-MM-DD). en-CA 로케일이 곧 ISO 날짜 형식. */
export function kstToday(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * 타임스탬프(ISO 문자열·Date) → **KST 날짜**(YYYY-MM-DD). 파싱 불가·빈값은 null
 * (없는 날짜를 지어내지 않는다 — 감사로그 metadata의 날짜가 이 함수를 탄다).
 * 🔴 `iso.slice(0, 10)`을 쓰지 말 것 — 그건 **UTC 날짜**라 00:00~08:59 KST에 하루 전으로 적힌다
 *    (아침 회의·심야 상담이 화면과 하루 어긋난다). 화면이 KST로 보여주는 값과 같아야 한다.
 */
export function kstDateOf(value: unknown): string | null {
  const d =
    value instanceof Date
      ? value
      : typeof value === "string" && value.trim()
        ? new Date(value)
        : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  return kstToday(d);
}

/** KST 기준 이번 달 1일(YYYY-MM-01). */
export function kstMonthStart(d: Date = new Date()): string {
  return `${kstToday(d).slice(0, 7)}-01`;
}

/** KST 기준 이번 달(YYYY-MM). */
export function kstMonth(d: Date = new Date()): string {
  return kstToday(d).slice(0, 7);
}

/**
 * KST 기준 "지금"을 `datetime-local` 입력이 받는 모양(`YYYY-MM-DDTHH:mm`)으로.
 * 🔴 `new Date()`의 로컬 게터로 만들지 말 것 — 그 값은 **런타임 시간대**라 SSR(서버=UTC)과 브라우저(KST)가
 *    다른 기본값을 렌더한다(9시간 어긋난 시각이 폼에 박힌 채 저장된다).
 */
export function kstDateTimeLocal(d: Date = new Date()): string {
  return `${kstToday(d)}T${kstTimeOf(d) ?? "00:00"}`;
}

/**
 * KST 기준 올해(숫자). 🔴 `new Date().getFullYear()`를 쓰지 말 것 — 서버는 UTC라 **1월 1일 00:00~08:59 KST**
 * 구간에 **작년**이 나온다(연도 기본값·연도 칩이 통째로 한 해 어긋난다).
 */
export function kstYear(d: Date = new Date()): number {
  return Number(kstToday(d).slice(0, 4));
}

/**
 * 타임스탬프(ISO 문자열·Date) → **KST 시각**("HH:MM"). 파싱 불가·빈값은 null(없는 시각을 지어내지 않는다).
 * 🔴 `iso.slice(11, 16)`을 쓰지 말 것 — 그건 **UTC 시각**이라 화면에 9시간 이른 시각이 찍힌다
 *    (셔틀 "13:46 출발"이 "04:46 출발"로 보인다). 날짜 쪽 `kstDateOf`와 같은 이유·같은 규약이다.
 */
export function kstTimeOf(value: unknown): string | null {
  const d =
    value instanceof Date
      ? value
      : typeof value === "string" && value.trim()
        ? new Date(value)
        : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).format(d);
}

/**
 * 타임스탬프(ISO 문자열·Date) → **KST 짧은 표기** `yy.mm.dd hh:mm`(24시간). 원장 지정 서식
 * (2026-09-10, 시간표 '시트 반영' 옆 최근 반영 시각). 파싱 불가·빈값은 null —
 * 🔴 **빈 문자열을 돌려주지 말 것**: 빈 칸은 "방금 했음"으로 읽힌다. 호출부가 null을 받아
 * `아직 반영 안 함` 같은 **말이 되는 문구**를 직접 적는다.
 *
 * 🔴 자리 계산은 `kstDateOf`·`kstTimeOf`에 맡긴다(`Asia/Seoul` 고정) — 서버가 UTC라
 *    `toISOString().slice()`로 자르면 한국 새벽에 하루가 어긋난다.
 */
export function kstShortStamp(value: unknown): string | null {
  const date = kstDateOf(value);
  const time = kstTimeOf(value);
  if (!date || !time) return null;
  return `${date.slice(2).replaceAll("-", ".")} ${time}`;
}

/**
 * `<input type="datetime-local">`이 보낸 값(**타임존이 없는** `YYYY-MM-DDTHH:mm`)을 **KST로 읽어** ISO로.
 *
 * 🔴 왜 필요한가(원장 제보 2026-09-09 *"'상담 시각'이 방금전인데 버그 아닌가?"*): 그 입력의 값은 브라우저의
 *    **로컬 벽시계**(여기선 KST)인데 서버 액션이 `new Date(값)`으로 읽었다. 서버(Vercel)는 **UTC**라 같은 글자를
 *    UTC로 해석해 **정확히 9시간 뒤**로 저장됐다 — 실측: 13:12 KST에 만든 상담이 13:12Z(=22:12 KST)로 앉았고,
 *    미래 시각이라 목록의 상대 시각이 전부 "방금 전"으로 찍혔다. 오후 3시 이후 입력분은 **날짜까지 다음 날**로 넘어간다
 *    (최근 60일 KST 시각 분포에서 00시 245건·22시 35건 = 학원 운영시간 밖).
 * 🔑 이미 타임존이 붙은 값(`…Z`·`+09:00`)은 **그대로** 읽는다 — 녹음 상담 폼처럼 클라이언트에서 이미 변환해
 *    보내는 경로가 있어서, 여기서 또 KST를 붙이면 그쪽이 거꾸로 9시간 어긋난다.
 * @returns ISO 문자열. 빈 값·해석 불가는 null(없는 시각을 지어내지 않는다).
 */
export function kstLocalToIso(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  // 타임존이 이미 있으면 그 값이 진실이다.
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text);
  const iso = hasZone
    ? text
    : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(text)
      ? `${text}+09:00`
      : text;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** KST 기준 현재 시각의 자정 기준 분(0–1439) — 서버 UTC에서 now.getHours()가 9시간 어긋나는 것 방지. */
export function kstMinutesOfDay(d: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  return get("hour") * 60 + get("minute");
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const DOW_KO = ["일", "월", "화", "수", "목", "금", "토"] as const;

/**
 * URL에서 온 `YYYY-MM-DD`가 **달력에 실제로 있는 날**인가 — 모양 + 왕복 검사(`2026-02-30`·`2026-13-01`은 거짓).
 * 🔴 모양만 보고 통과시키면 없는 날짜가 PostgREST에 실려 400 → 화면 500이 된다. 거짓이면 호출부는 **필터 없음**으로.
 */
export function isValidYmd(raw: unknown): raw is string {
  if (typeof raw !== "string" || !YMD.test(raw)) return false;
  const [y, m, d] = raw.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  // 0~99년은 Date.UTC가 1900년대로 옮겨 버린다 — 왕복 비교가 그것까지 걸러낸다.
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m! - 1 && dt.getUTCDate() === d;
}

/** URL에서 온 `YYYY-MM`이 실제로 있는 달인가(01~12). 거짓이면 호출부는 필터 없음으로. */
export function isValidYm(raw: unknown): raw is string {
  return typeof raw === "string" && /^\d{4}-\d{2}$/.test(raw) && isValidYmd(`${raw}-01`);
}

/**
 * 작성·발송 대상 날짜 정규화 — 사용자가 고른 날짜(YYYY-MM-DD)를 안전 범위로 클램프.
 * 빈값·형식오류·미래(오늘 초과)는 KST 오늘로. **과거는 그대로**(저장 허용) — 발송 too_old 가드
 * (isClassnoteAllowed=전 달 1일 이후)가 별도로 실발송 범위를 강제한다. 순수 함수(Vitest).
 * report_date 단일 소스 = 학부모 카드 표시일 = ClassNote 게시일(worker) → 세 날짜 일치 보장.
 */
export function resolveReportDate(raw?: string | null, today: string = kstToday()): string {
  if (!raw || !YMD.test(raw)) return today;
  return raw > today ? today : raw; // 문자열 사전순 = 날짜순(YYYY-MM-DD)
}

/** YYYY-MM-DD의 요일 인덱스(0=일 … 6=토). UTC 파싱이라 서버 TZ와 무관하게 결정적. */
export function weekdayIndexOf(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay();
}

/**
 * 두 날짜(YYYY-MM-DD)의 일수 차 = **to − from**(같은 날 0 · to가 뒤면 양수). 날짜가 이상하면 NaN.
 * UTC 산술이라 DST·TZ 무관. 🔴 인자 순서는 "어디서 → 어디까지" — 옛 `daysBetween(a, b)`(출결 7일 잠금 = a − b)와 반대다.
 */
export function diffDays(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.NaN;
  return Math.round((b - a) / 86_400_000);
}

/** YYYY-MM-DD에 n일 더한 날짜(YYYY-MM-DD). UTC 산술이라 DST·TZ 영향 없음. n 음수=이전. */
export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  dt.setUTCDate(dt.getUTCDate() + n);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * 오늘을 포함하는 최근 N일 창의 시작일.
 * 예: 7일 창은 오늘과 이전 6일을 포함한다. 0 이하 입력도 최소 1일(오늘)로 안전하게 제한한다.
 */
export function inclusiveDateWindowStart(todayYmd: string, days: number): string {
  const normalizedDays = Number.isFinite(days) ? Math.max(1, Math.trunc(days)) : 1;
  return addDays(todayYmd, -(normalizedDays - 1));
}

/** YYYY-MM-DD → "2026년 7월 14일 (월)" 표시 문자열(요일은 UTC 파싱 결정적). */
export function formatKoreanDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return `${y}년 ${m}월 ${d}일 (${DOW_KO[weekdayIndexOf(ymd)]})`;
}

/**
 * YYYY-MM-DD → "9/11" — 월/일만, **앞자리 0 없이**(`09/01`이 아니라 `9/1`).
 * 🔑 같은 날짜가 화면마다 다른 모양으로 적히지 않게 **앞자리 0 제거 규칙은 여기 한 곳**에 둔다 —
 *    `features/timetable/scheduled-import.ts`의 `monthDay`(예약 배지·배너)와 캘린더 목록의 `shortDate`가
 *    이 함수에 위임한다. 형식이 아니면 원문 그대로(없는 날짜를 지어내지 않는다).
 */
export function monthDayLabel(ymd: string): string {
  const [, m, d] = ymd.split("-");
  if (!m || !d) return ymd;
  return `${Number(m)}/${Number(d)}`;
}

/**
 * YYYY-MM-DD → "9/11 (금)" — 연도 없이 월/일 + 요일. 카드 보조 줄처럼 **좁은 자리**에서 "그게 며칠인가"를
 * 한 번에 말할 때(출석부 결석 보기·브리핑의 기준일). 요일을 함께 적는 이유: 주말·휴일이면 0명이 당연하다는 것을
 * 사람이 바로 읽는다. 월/일은 `monthDayLabel` 한 곳에서 만든다.
 *
 * 🔴 `Intl.DateTimeFormat`을 쓰지 않는다 — `timeZone`을 빠뜨리면 **런타임의 시간대**로 포맷된다
 *    (`formatKoreanDate`·`formatKoreanDateLong`과 같은 이유. 여기는 이미 확정된 날짜 문자열이다).
 */
export function formatShortKoreanDate(ymd: string): string {
  // 🔴 모양(`YMD.test`)만 보면 `2026-13-99`가 통과해 `Date.UTC`가 굴러가 **없는 날의 요일**을 지어낸다
  //    (실측 "13/99 (금)"). 달력에 있는 날만 요일을 붙이고, 아니면 원문 그대로 돌려준다.
  if (!isValidYmd(ymd)) return ymd;
  return `${monthDayLabel(ymd)} (${DOW_KO[weekdayIndexOf(ymd)]})`;
}

/**
 * YYYY-MM-DD → "2026년 7월 14일 월요일"(요일 **긴 이름**). 출석부 날짜 머리처럼 요일을 풀어 쓰는 자리용.
 *
 * 🔴 `Intl.DateTimeFormat`을 쓰지 않는다 — `timeZone`을 빠뜨리면 **런타임의 시간대**로 포맷돼서 서버(UTC)와
 *    브라우저(KST)가 다른 답을 낼 수 있다. 여기는 이미 확정된 날짜 문자열이라 계산이 필요 없다.
 */
export function formatKoreanDateLong(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return `${y}년 ${m}월 ${d}일 ${DOW_KO[weekdayIndexOf(ymd)]}요일`;
}

/**
 * `formatKoreanDate` 라벨을 `PeriodNav`에 세울 때의 `labelWidth` — 최장 "2026년 12월 31일 (수)"(18px 굵게 실측 182px)가
 * ×1.4 뒤 213px에 들어간다(최장 실측 182px, 여유 13px). 원스크린 상단 바·ECS 오늘 면·셔틀 날짜 면이 같은 라벨을
 * 쓰므로 폭도 여기 하나 — 그전엔 ECS 오늘 면 180 · 셔틀 152로 갈려 있었다(디자인 v5 18단계 리뷰).
 * 주 라벨은 `WEEK_LABEL_W`(timetable/lib/week.ts).
 */
export const DAY_LABEL_W = 152;

/**
 * "YYYY-MM" → 그 달의 첫날·마지막날. 목록/달력의 **월 단위 조회 범위**를 만드는 단일 소스.
 * ⚠️ `new Date(ymd)`는 UTC 파싱이라 KST에서 하루 밀린다 — 말일은 `Date.UTC(y, m, 0)`으로 구한다.
 */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate(); // m월 0일 = (m-1)월 말일
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

/**
 * "YYYY-MM" → 그 달 **KST 1일 00:00**의 절대시각(ISO). `timestamptz` 컬럼과 비교하는 **월 경계의 단일 소스**.
 *
 * 🔴 `new Date(y, m, 1).toISOString()`을 쓰지 말 것 — 그건 **런타임 로컬 자정**이라 서버(UTC)에선
 *    `YYYY-MM-01T00:00:00Z`가 되고, 이는 KST로 **오전 9시**다. 그 9시간 동안의 상담·수납이 앞 달로 샌다.
 */
export function kstMonthStartIso(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, 1, -9, 0, 0)).toISOString();
}

/** 달 이동(-1/+1). 연 경계를 넘어간다. */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** "2026-07" → "2026년 7월". */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${y}년 ${m}월`;
}

/** "YYYY-MM-DD" → "YYYY-MM". */
export function monthOf(ymd: string): string {
  return ymd.slice(0, 7);
}
