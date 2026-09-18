/**
 * `leave_adjustments.used_on`(0270a) **미적용 판정** — 순수 함수(조회·쓰기 공용, Vitest).
 *
 * 🔑 왜 필요한가: eywa는 SQL을 사람이 손으로 적용하므로 **앱이 먼저 배포되는 창**이 늘 있다([[#95]]).
 *    그 창에서 `select … used_on`은 PostgREST가 400(42703)으로, insert는 PGRST204로 거절하는데 그대로
 *    던지면 연차 관리 표와 내 정보 카드가 통째로 에러 배너가 된다. 그래서 "이 컬럼이 없다"만 골라내
 *    **컬럼을 뺀 조회로 한 번 더** 시도한다.
 *
 * 🔴 표 없음(`isMissingRelation`)과는 **다른 판정**이다 — 표가 없으면 조정 기능 자체가 준비 안 된 것이라
 *    화면이 배너를 띄우고 편집을 잠그지만, 컬럼만 없으면 조정은 되고 사용일만 못 적는다(둘을 한 판정으로
 *    묶으면 0270a 전에 조정 기능이 통째로 잠긴다).
 *
 * ⚠️ 컬럼 이름이 메시지에 **함께** 나올 때만 참이다 — "column … does not exist"만 보고 참을 내면 남의
 *    오타(다른 컬럼)를 사용일 문제로 오진해 조용히 폴백하고, 정작 그 오타는 영원히 안 보인다.
 */

/** PostgREST/Postgres 오류(객체·Error·문자열 무엇이든)에서 판정에 쓸 글자만 모은다. */
function messageOf(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw instanceof Error) return raw.message;
  const e = raw as { message?: unknown; code?: unknown; details?: unknown } | null | undefined;
  return [e?.message, e?.code, e?.details].filter((v) => typeof v === "string").join(" ");
}

export function isMissingUsedOnColumn(raw: unknown): boolean {
  const msg = messageOf(raw);
  // 컬럼 이름이 없으면 다른 실패다 — 넓게 잡지 않는다(위 ⚠️).
  if (!/used_on/i.test(msg)) return false;
  // 42703 = undefined_column(조회) · PGRST204 = 스키마 캐시에 컬럼 없음(쓰기).
  return /42703|PGRST204|does not exist|could not find/i.test(msg);
}
