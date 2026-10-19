// 전사 웹훅 재전송 걸러 내기 — 순수 함수(Vitest). 라우트 파일은 정해진 이름만 내보낼 수 있어 여기 둔다.
/**
 * 분석이 **방금 시작돼 아직 도는 중**인가 — 같은 알림의 재전송을 걸러 낸다(2026-10-19).
 * 10분 = 이 라우트의 최대 실행 시간(300초)보다 넉넉히. 그보다 오래 'analyzing'이면 죽은 것으로 보고 다시 돌게 둔다
 * (`updated_at`은 세 표 모두 트리거가 갱신 — tg_set_updated_at).
 */
export const IN_FLIGHT_MS = 10 * 60_000;
export function isFresh(updatedAt: string | null | undefined, now = Date.now()): boolean {
  if (!updatedAt) return false;
  const t = new Date(updatedAt).getTime();
  return Number.isFinite(t) && now - t < IN_FLIGHT_MS;
}
export function isInFlight(status: string | null | undefined, updatedAt: string | null | undefined): boolean {
  return status === "analyzing" && isFresh(updatedAt);
}

