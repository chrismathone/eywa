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

/** KST 기준 이번 달 1일(YYYY-MM-01). */
export function kstMonthStart(d: Date = new Date()): string {
  return `${kstToday(d).slice(0, 7)}-01`;
}

/** KST 기준 이번 달(YYYY-MM). */
export function kstMonth(d: Date = new Date()): string {
  return kstToday(d).slice(0, 7);
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
