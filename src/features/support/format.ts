/** 고객센터 날짜 표기 — KST 고정(`Intl` timeZone). 순수 함수(서버·클라 공용). */

const DATE_TIME = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const DATE_ONLY = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** `2026-08-25 14:40` — 등록일시(makeedu 목록 표기와 같은 모양, 초는 뺀다). */
export function fmtSupportDateTime(iso: string): string {
  return DATE_TIME.format(new Date(iso));
}

/** `2026-08-25` — 공지 등록일. */
export function fmtSupportDate(iso: string): string {
  return DATE_ONLY.format(new Date(iso));
}
