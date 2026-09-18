import "server-only";

/**
 * 운영 기간이 끝나 닫힌 수강의 사유(0274a) — SQL의 문자열과 **글자까지 같아야** 한다. 사람이 종료일을 고치면 앱이 이 사유를 지운다
 * (`updateEnrollmentDates` — 사람이 정한 날짜에 "운영 기간 종료"라 적혀 있으면 거짓이다).
 * 🔑 닫는 건 매일 밤 cron(`/api/cron/close-ended-class-periods`)이다 — **미래 종료일을 미리 박지 않는다**(앱 26곳이 "종료일이
 *    비었으면 수강 중"으로 판정해, 미리 박으면 그 사이 퇴원·휴원·반 폐지·공지 대상에서 수강이 빠진다 — 적대 리뷰 2026-09-18).
 */
export const PERIOD_END_REASON = "운영 기간 종료";

/** PostgREST가 함수를 못 찾을 때(마이그레이션 전) — 실패가 아니라 "아직 안 켜짐"이다. */
export function isMissingFunction(error: { code?: string; message?: string }): boolean {
  return error.code === "PGRST202" || /could not find the function/i.test(error.message ?? "");
}
