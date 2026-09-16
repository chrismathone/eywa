// 회차 **이월(carryover)** 순수 규칙 — 결석분을 다음 달 보강으로 받아가는 흐름(원장 2026-07-22). 순수 함수(Vitest).
//
// 원장 규칙: 보강은 **실제 수업한 달**로 차수가 간다.
//   5월 8회 예정·1회 결석 → 5월은 7회가 최대치, 6월은 8회 + 5월 보강 1회 = 9회분.
// 청구서는 그대로 둔다(5월 8회분은 이미 수납). 움직이는 건 **급여 상한**뿐이다.
//
// ⚠️ 불변 제약(원장): **"더한 수업이 절대 급여에 포함되어서는 안 된다 — 학원의 명백한 손해."**
//   → 급여 상한을 올릴 수 있는 **유일한 근거는 '기록된 이월'**(= 학원이 이미 받은 돈)이다.
//     기록 없는 초과 수업은 상한에 잘린다. 이 모듈의 모든 상한은 그 방향으로만 열린다.
//
// 방향 정의(verification.ts와 동일): diff = 실측 − 확정(청구).
//   · short(diff<0) = 낸 만큼 안 나감 → **이월 재원**(carryover_out 후보)
//   · over (diff>0) = 더 나감      → 이월 크레딧이 있어야만 지급(carryover_in 후보)

import type { VerificationVerdict } from "./verification";

/** 출석부와 같은 소수 한 자리 시수. 부족분 0.5도 이월 근거로 보존한다. */
function wholeSessions(v: number): number {
  return Math.max(0, Math.round(v * 10) / 10);
}

/**
 * 이 달에서 **다음 달로 넘길 수 있는 최대 회차** = 그 달 부족분(청구 − 실측).
 * short가 아니면 0 — 넘길 재원 자체가 없다(초과분을 이월로 둔갑시키지 못하게).
 */
export function maxCarryoverOut(verdict: VerificationVerdict): number {
  if (verdict.status !== "short" || verdict.diff === null) return 0;
  return wholeSessions(-verdict.diff);
}

/**
 * 이 달에서 **받아 쓸 수 있는 최대 회차** = min(초과분, 남은 크레딧).
 * over가 아니면 0 — 초과 수업이 없는데 크레딧을 태워 상한을 올리는 일은 없다.
 * `availableCredit` = 이전 달 `carryover_out` 중 아직 안 쓴 몫(호출부가 조회해 넘긴다).
 */
export function maxCarryoverIn(verdict: VerificationVerdict, availableCredit: number): number {
  if (verdict.status !== "over" || verdict.diff === null) return 0;
  const credit = wholeSessions(availableCredit);
  return Math.min(wholeSessions(verdict.diff), credit);
}

/**
 * 급여 상한 회차 = 확정(청구) + 받아온 이월. **2단계에서 소비**한다(1단계는 기록만).
 * ⚠️ 이 함수가 상한을 올리는 **유일한 경로**여야 한다 — 실측을 그대로 상한으로 쓰면 원장 제약이 깨진다.
 */
export function payrollCapSessions(confirmedSessions: number | null, carryoverIn: number): number | null {
  if (confirmedSessions === null) return null;
  return confirmedSessions + wholeSessions(carryoverIn);
}

/**
 * 실제 지급 인정 회차 = min(실측, 상한). 상한을 넘는 초과분은 **버린다**(학원 손해 방지).
 * 실측 미기록(null)이면 상한을 그대로 쓴다 — 0으로 지어내 급여를 지우지 않는다(기존 actualMissing 규율과 동일).
 */
export function payableSessions(
  actualConsumed: number | null,
  confirmedSessions: number | null,
  carryoverIn: number,
): number | null {
  const cap = payrollCapSessions(confirmedSessions, carryoverIn);
  if (cap === null) return null;
  if (actualConsumed === null) return cap;
  return Math.min(actualConsumed, cap);
}

/** 이월 결정 입력 검증(서버 액션이 재검증). 사유는 상한을 올리는 쪽(in)일 때 감사용으로 권장. */
export type CarryoverDecision = { out?: number; in?: number };

export function validateCarryover(
  decision: CarryoverDecision,
  limits: { maxOut: number; maxIn: number },
): { ok: true; out: number; in: number } | { ok: false; error: string } {
  const out = decision.out ?? 0;
  const inn = decision.in ?? 0;
  const valid = (n: number) => Number.isFinite(n) && n >= 0 && Math.abs(n * 10 - Math.round(n * 10)) < 1e-8;
  if (!valid(out) || !valid(inn)) return { ok: false, error: "이월 시수는 0 이상, 소수 한 자리까지 입력하세요" };
  if (out > limits.maxOut) return { ok: false, error: `넘길 수 있는 회차는 최대 ${limits.maxOut}회입니다(그 달 부족분)` };
  // ⚠️ 여기가 원장 제약의 마지막 방어선 — 크레딧 없이 상한을 올리려는 시도를 거절한다.
  if (inn > limits.maxIn) return { ok: false, error: `받아올 수 있는 회차는 최대 ${limits.maxIn}회입니다(이전 달 이월분)` };
  return { ok: true, out, in: inn };
}
