// 회차 확정 **금액 이월** — 순수 규칙(Vitest). 원장 2026-09-21:
//   *"김지호 학생 만원 남은걸 다음달로 금액 넘기는 기능이 없지? '이월' 기능 추가해야겠어."*
//   → 선택: 받을 반은 **이월할 때 고른다**(그 학생의 다음 달 반) · **수납액 분배에도 반영한다**.
//
// 🔑 저장은 보내는 달 회차 행 한 곳(0278a `allocation_carry_*`). 받는 달은 지난 달 행을 읽어 붙인다.
// 🔴 보내는 달의 '−이월'과 받는 달의 '+이월'은 **같은 유효성 판정**(`carryOutValid`)을 지난다 — 한쪽만 유효로 보면
//    같은 돈이 두 번(또는 0번) 분배된다. 판정 재료는 `invoiceAllocationStates`(유효 배분·재확인·환불) 한 벌.
// 🔴 수납 배분 원본(`allocatedAmount` — 청구 항목 합계와 맞춘 값)은 그대로다. 배분 창은 원본을 편집하고,
//    분배·표시의 '실납'만 `netAllocatedAmount`로 읽는다.
// ⚠️ 회차(시수) 이월(`carryover.ts`, 0134a)과는 다른 물건이다 — 그쪽은 급여 상한을 올리는 회차다.

/** 보낸 이월이 다음 달에 착지했나 — `landed` 더해짐 · `waiting` 받을 줄은 있고 배분 전 · `orphan` 받을 줄이 없다. */
export type MoneyCarryLanding = "landed" | "waiting" | "orphan";

export type MoneyCarryOut = {
  amount: number;
  toClassId: string | null;
  toClassName: string | null;
  toPeriod: string;
  note: string | null;
  at: string | null;
  /** 회차 확정 면만 싣는다(출석부 금액 열은 안 본다). 모르면 없음. */
  landing?: MoneyCarryLanding;
};

export type MoneyCarryIn = {
  amount: number;
  fromPeriod: string;
  fromClassName: string | null;
  note: string | null;
  /** 보내는 달 행이 지금도 이월 조건을 만족하는가(`carryOutValid`) — 아니면 표시만 하고 더하지 않는다. */
  valid: boolean;
  /** 받을 반 줄이 이 달에 없어 학생의 다른 줄에 붙여 보이는 이월 — 더하지 않는다(어느 반 몫인지 모른다). */
  orphan?: boolean;
  /** `orphan`의 사유가 '줄 없음'이 아니라 **받을 줄이 전부 환불**이다(표시 문구만 가른다). */
  refunded?: boolean;
};

export type CarrySource = {
  allocatedAmount?: number | null;
  allocationStale?: boolean;
  amount: number | null;
  confirmedSessions: number | null;
  /** 전액 환불이면 배분액 0은 **저장된 배분이 아니라** 환불로 만든 값이다 — 받은 이월을 싣지 않는다(적대 리뷰 2026-09-21). */
  refundState?: string;
  /** 환불로 만든 배분 0(반 이름 매칭 밖의 공유 줄 환불 포함, `invoiceAllocationStates.refundedAllocation`). */
  refundedAllocation?: boolean;
  /**
   * 이 줄에 붙은 **받은 이월**(지난 달에서) — 실납에 더해지고(`netAllocatedAmount`) **더 받은 몫에도 든다**(`carrySurplus`, 연쇄 이월).
   * 🔴 붙이는 줄은 `attachMoneyCarry`(화면) · `loadMoneyCarryIns`(받는 달이 보낸 달을 다시 볼 때)가 같은 줄이다 — (학생, 반)의 그 달 회차 행 하나.
   */
  carryIns?: readonly MoneyCarryIn[];
};

/** 환불로 배분이 0이 된 줄 — 이월을 받을 수 없다. */
export function carryRefunded(r: Pick<CarrySource, "refundState" | "refundedAllocation">): boolean {
  return r.refundState === "full" || !!r.refundedAllocation;
}

/**
 * 이 줄이 **받은 이월을 실납에 더할 수 있나** — 유효 배분이 있고(재확인 아님) 환불로 만든 0이 아니다.
 * 🔴 받는 달(`netAllocatedAmount`·`attachMoneyCarry`)과 보낸 달 도착 판정(`carryLanding`)이 이 한 함수를 쓴다 — 한쪽만 다르게 보면
 *    보낸 달은 빼고 받는 달은 안 더하는 0번 분배가 조용히 남는다(재리뷰 2026-09-21).
 */
export function canReceiveCarry(r: CarrySource): boolean {
  return r.allocatedAmount != null && !r.allocationStale && !carryRefunded(r);
}

/**
 * 받는 달에 같은 (학생, 반) 줄이 여럿이면 어느 줄에 붙이나 — 작을수록 먼저. 받을 수 있는 줄 → 환불 아닌 회차 행 → 가상 행 → 환불 줄.
 * 가장 앞 줄이 환불 줄(3)이면 그 이월은 **받을 곳이 없다**(orphan로 막는다).
 */
export function carryTargetRank(r: CarrySource & { termState?: string }): number {
  if (canReceiveCarry(r)) return 0;
  if (r.termState === "term") return carryRefunded(r) ? 3 : 1;
  return 2;
}

/**
 * 보낸 이월의 도착 상태 — 받는 달의 (학생, 받을 반) 회차 행들과 줄 집합 유무로. `carryTargetRank`와 같은 규칙:
 * 받을 수 있는 회차 행 → `landed` · 회차 행이 전부 환불이거나 줄이 아예 없음 → `orphan`(분배 저장을 막는다) · 그 밖 → `waiting`.
 */
export function carryLanding(terms: readonly CarrySource[], hasRosterPair: boolean): MoneyCarryLanding {
  if (terms.some(canReceiveCarry)) return "landed";
  if (terms.length > 0) return terms.every(carryRefunded) ? "orphan" : "waiting";
  return hasRosterPair ? "waiting" : "orphan";
}

/** 0278a 미적용(컬럼·함수 없음) 오류 문구인가 — 실패가 아니라 '이월 없음'으로 본다. 그 밖(권한·시간 초과 등)은 실패. */
export function isCarryColumnMissing(message: string): boolean {
  return /allocation_carry_\w+[^]*does not exist|does not exist[^]*allocation_carry_|Could not find[^]*allocation_carry_/i.test(message);
}

/**
 * 확정액보다 더 받은 몫 = 이월할 수 있는 최대 금액 = **배분액 + 받은 이월 − 확정액**. 시수 확정·유효 배분이 없거나 재확인 필요면 0
 * (전액 환불은 배분액이 0이라 저절로 0).
 * 🔑 받은 이월도 넣는다 — 원장 2026-11-09(조은준 9월: 배분 312,000 + 8월 이월 24,000 = 실납 336,000 · 확정 27시수 324,000)
 *    *"이미 8월 → 9월로 한번 이월을 받았는데, 9월에서 남은 시수를 10월로 이월이 안되게 막혀있음"*. 배분액만 보면 0원이라 '이월' 버튼이
 *    아예 안 섰다. 받은 이월에서 남은 몫도 다음 달로 다시 넘길 수 있다(연쇄 이월).
 * 🔴 받는 달이 이 판정을 다시 할 때도 보내는 달 행에 **그 달이 받은 이월**을 붙여야 같은 값이 나온다(`loadMoneyCarryIns`) —
 *    한쪽만 넣으면 보낸 달은 빼고 받는 달은 안 더해 돈이 사라진다. DB 함수 상한도 같은 뜻이다(s2_0033).
 */
export function carrySurplus(r: CarrySource): number {
  if (r.allocatedAmount == null || r.allocationStale || r.amount == null || r.confirmedSessions == null) return 0;
  return Math.max(0, r.allocatedAmount + receivedCarry(r) - r.amount);
}

/** 저장된 이월이 지금도 유효한가 — 배분을 다시 저장해 더 받은 몫이 줄었으면 무효(보내는 쪽도 받는 쪽도 반영 안 함). */
export function carryOutValid(r: CarrySource, carryOut: number): boolean {
  return carryOut > 0 && carryOut <= carrySurplus(r);
}

/** 받은 이월 중 실제로 더하는 금액. */
export function carryInTotal(carryIns: readonly MoneyCarryIn[] | undefined): number {
  return (carryIns ?? []).reduce((sum, c) => sum + (c.valid && !c.orphan ? c.amount : 0), 0);
}

/**
 * 이 줄 실납에 **지금 실리는** 받은 이월 — 받을 수 없는 줄(배분 없음·재확인·환불)이면 0.
 * 실납(`netAllocatedAmount`)과 더 받은 몫(`carrySurplus`)이 이 한 값을 쓴다.
 */
export function receivedCarry(r: CarrySource): number {
  return canReceiveCarry(r) ? carryInTotal(r.carryIns) : 0;
}

/**
 * 분배·표시가 쓰는 실납 = 배분액 − 유효한 보낸 이월 + 유효한 받은 이월.
 * 배분이 없으면 null — 받은 이월은 그 달 배분을 저장해야 실린다(그 전엔 '이월 +N' 표식만). 전액 환불 줄에도 안 싣는다.
 */
export function netAllocatedAmount(r: CarrySource & { carryOut?: MoneyCarryOut | null }): number | null {
  if (r.allocatedAmount == null) return null;
  const out = r.carryOut && carryOutValid(r, r.carryOut.amount) ? r.carryOut.amount : 0;
  return r.allocatedAmount - out + receivedCarry(r);
}

/**
 * 분배 저장을 막을 이월 문제 — 받을 줄이 없는 이월(보낸 쪽 `orphan` · 받는 쪽 `orphan`)은 어느 달에도 분배되지 않는다.
 * 보낸 달에서 이월을 취소하거나 받을 반을 다시 골라야 한다.
 */
export function carryBlocksSplits(r: CarrySource & { carryOut?: MoneyCarryOut | null }): boolean {
  return (!!r.carryOut && r.carryOut.landing === "orphan" && carryOutValid(r, r.carryOut.amount)) || (r.carryIns ?? []).some((c) => c.orphan && c.valid);
}

export const MONEY_CARRY_NOTE_MAX = 200;

/** 저장 입력 검증 — 서버 액션이 유효 배분·다음 달 반 목록을 다시 구해 이 함수로 본다(#77). amount 0 = 이월 취소. */
export function validateMoneyCarry(
  input: { amount: number; classId: string | null; note: string | null },
  limits: { surplus: number; classIds: readonly string[] },
): { ok: true } | { ok: false; error: string } {
  if (!Number.isSafeInteger(input.amount) || input.amount < 0) return { ok: false, error: "이월 금액은 0 이상 원 단위로 입력하세요" };
  if ((input.note ?? "").length > MONEY_CARRY_NOTE_MAX) return { ok: false, error: `메모는 ${MONEY_CARRY_NOTE_MAX}자까지 적을 수 있습니다` };
  if (input.amount === 0) return { ok: true };
  if (input.amount > limits.surplus) return { ok: false, error: `넘길 수 있는 금액은 최대 ${limits.surplus.toLocaleString("ko-KR")}원입니다(확정액보다 더 받은 몫)` };
  if (!input.classId || !limits.classIds.includes(input.classId)) return { ok: false, error: "받을 반을 다음 달 반 중에서 골라 주세요" };
  return { ok: true };
}

/**
 * **이월 재확인이 필요한 줄**(회차 확정 '보기' 필터 · 머리 줄 건수, 원장 2026-11-09 *"계속"* — 경고가 없는 경로까지 한곳에서 보이게).
 * 표가 줄마다 띄우는 표식과 같은 기준이다(`MoneyCarryTags`):
 *  · 보낸 이월이 무효('이월 재확인')이거나 받을 반이 없다(`landing: orphan`) — 다음 달 실납에 안 실린다.
 *  · 받은 이월이 무효이거나 받을 곳이 없다(`orphan`) — 이 달 실납에 안 실린다.
 * 🔑 어떻게 무효가 됐는지(확정·해제·배분·청구서 수정·환불·합산·메이크에듀 동기화·앞 달 연쇄)와 무관하게 **결과**를 본다 — 경로마다 경고를
 *    달 수 없는 자동 변경(동기화)까지 이 한 곳에서 잡힌다.
 */
export function carryNeedsRecheck(r: CarrySource & { carryOut?: MoneyCarryOut | null }): boolean {
  const out = r.carryOut;
  if (out && out.amount > 0 && (!carryOutValid(r, out.amount) || out.landing === "orphan")) return true;
  return (r.carryIns ?? []).some((c) => !c.valid || !!c.orphan);
}
