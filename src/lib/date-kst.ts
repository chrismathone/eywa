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
 * "YYYY-MM" → 그 달의 첫날·마지막날. 목록/달력의 **월 단위 조회 범위**를 만드는 단일 소스.
 * ⚠️ `new Date(ymd)`는 UTC 파싱이라 KST에서 하루 밀린다 — 말일은 `Date.UTC(y, m, 0)`으로 구한다.
 */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate(); // m월 0일 = (m-1)월 말일
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
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
