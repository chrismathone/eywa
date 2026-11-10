/**
 * 작은 공용 판정·계산 — 화면·서버 어디서나 쓴다(🔴 `server-only` 금지 — 클라이언트도 import한다, #61).
 * 같은 한 줄을 파일마다 다시 적지 말 것(수정 계획 P2-H — `isRecord` 11벌 · `round1` 9벌이 있었다).
 */

/** 평범한 객체(배열·null 아님)인가 — jsonb·외부 입력을 열어 볼 때. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 소수 첫째 자리 반올림(`Math.round(n × 10) / 10`). */
export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
