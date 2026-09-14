// 시수 검증 순수 판정 — 확정 N(청구값으로 인정되는 유일한 값, N1) vs 실 소비 출석.
// 자동 수정 없음(N2): diff는 점검 신호일 뿐, 어느 쪽도 자동으로 맞추지 않는다.
// docs/per-session-billing-plan.md "시수 검증(a)".

export type VerificationStatus = "unconfirmed" | "matched" | "short" | "over";

export type VerificationVerdict = {
  status: VerificationStatus;
  /** 실측 − 확정. null = 미확정(판정 보류). +면 초과, −면 부족. */
  diff: number | null;
};

/**
 * 확정 회차(청구값)와 실 소비 출석을 대조.
 * - unconfirmed: 확정 전(청구값 없음) — 검증 대상 아님(계획 N은 참고).
 * - matched:     실측 == 확정.
 * - short:       실측 < 확정 (청구보다 실제 덜 나옴 → 과청구 점검).
 * - over:        실측 > 확정 (실제 더 나옴 → 미청구 점검).
 *
 * 실측은 **출석 일수**(0263a)라 정수다. 0.1 단위 반올림은 그대로 둔다 — 옛 시수 합(0115a) 시절의
 * 부동소수 잔차 방어이고, **골든 픽스처의 소수 값**(rpcConsumed 1.5·4.5)과 0263a 미적용·롤백 시의
 * RPC 출력이 여전히 이 함수를 지난다.
 * ⚠️ '저장된 스냅샷'은 소비처가 없다 — 호출부는 셋뿐이고(verification-queries·actions는 live RPC,
 *    golden.test는 픽스처) 어느 쪽도 저장된 splits 행을 읽지 않는다.
 */
export function classifyVerification(
  confirmedSessions: number | null,
  actualConsumed: number,
): VerificationVerdict {
  if (confirmedSessions === null) return { status: "unconfirmed", diff: null };
  const diff = Math.round((actualConsumed - confirmedSessions) * 10) / 10;
  if (diff === 0) return { status: "matched", diff: 0 };
  return { status: diff > 0 ? "over" : "short", diff };
}
