/**
 * `leave_adjustments`의 **휴가 사용 기간 칸**(`used_start`·`used_end`, 0270b — 0270a의 `used_on`이 개명한 것)
 * **미적용 판정** — 순수 함수(조회·쓰기 공용, Vitest).
 *
 * 🔑 왜 필요한가: aywa는 SQL을 사람이 손으로 적용하므로 **앱이 먼저 배포되는 창**이 늘 있다([[#95]]).
 *    그 창에서 `select … used_start`는 PostgREST가 400(42703)으로, insert는 PGRST204로 거절하는데 그대로
 *    던지면 연차 관리 표와 내 정보 카드가 통째로 에러 배너가 된다. 그래서 "이 칸이 없다"만 골라내
 *    **칸을 뺀 조회로 한 번 더** 시도한다.
 *
 * 🔴 표 없음(`isMissingRelation`)과는 **다른 판정**이다 — 표가 없으면 조정 기능 자체가 준비 안 된 것이라
 *    화면이 배너를 띄우고 편집을 잠그지만, 칸만 없으면 조정은 되고 사용 기간만 못 적는다.
 *
 * ⚠️ 옛 이름 `used_on`도 함께 알아본다 — 0270a만 적용된 DB에 새 앱이 배포된 창에서는 `used_start`가
 *    없다고 나오고, 반대로 옛 앱이 남아 있으면 `used_on`이 없다고 나온다. 어느 쪽이든 폴백은 같다.
 * ⚠️ 칸 이름이 메시지에 **함께** 나올 때만 참이다 — "column … does not exist"만 보고 참을 내면 남의
 *    오타(다른 컬럼)를 사용 기간 문제로 오진해 조용히 폴백하고, 정작 그 오타는 영원히 안 보인다.
 */

/** PostgREST/Postgres 오류(객체·Error·문자열 무엇이든)에서 판정에 쓸 글자만 모은다. */
function messageOf(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw instanceof Error) return raw.message;
  const e = raw as { message?: unknown; code?: unknown; details?: unknown } | null | undefined;
  return [e?.message, e?.code, e?.details].filter((v) => typeof v === "string").join(" ");
}

export function isMissingUsedRangeColumn(raw: unknown): boolean {
  const msg = messageOf(raw);
  // 칸 이름이 없으면 다른 실패다 — 넓게 잡지 않는다(위 ⚠️).
  if (!/\bused_(start|end|on)\b/i.test(msg)) return false;
  // 42703 = undefined_column(조회) · PGRST204 = 스키마 캐시에 컬럼 없음(쓰기).
  return /42703|PGRST204|does not exist|could not find/i.test(msg);
}
