/**
 * 0321a(`shuttle_ride_exceptions`의 행위자 칸 · `cancel_shuttle_ride_exception`)가 **아직 없는 DB**인지 — 순수 함수(Vitest).
 *
 * 🔴 0321a는 손으로 적용하는 alpha다. 앱이 먼저 배포되면 직원의 '오늘만 탐/안 탐'(0229a, 이미 쓰던 기능)이
 *    읽기 `42703` · 쓰기 `PGRST204` · 취소 함수 `PGRST202`로 전부 멈춘다([[#95]]). 잡히면 호출부는
 *    행위자 칸 없이 종전대로 읽고 쓴다 — 이력 장부에 '누가'가 안 남을 뿐 기능은 산다.
 */
export function isMissingActorColumns(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error || !/actor_kind|actor_name|parent_account_id/.test(error.message ?? "")) return false;
  return error.code === "42703" || error.code === "PGRST204";
}

/** `cancel_shuttle_ride_exception` 함수가 아직 없는가 — PostgREST는 PGRST202, 직접 호출은 42883. */
export function isMissingCancelFunction(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error || !/cancel_shuttle_ride_exception/.test(error.message ?? "")) return false;
  return error.code === "PGRST202" || error.code === "42883";
}
