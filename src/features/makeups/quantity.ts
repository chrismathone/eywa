/** 분 단위 잔량. 승인 전에는 null 이고, 음수는 0으로 숨기지 않고 명령을 거절한다. */

export type AllocationSlice = { minutes: number; recognized: boolean; released: boolean };

export type QuantityInput = {
  targetMinutes: number | null;
  signedAdjustments: number;
  verifiedRecognitions: number;
  approvedWaivers: number;
  allocations: readonly AllocationSlice[];
};

export type QuantityOk = {
  ok: true;
  pending: boolean;
  outstanding: number | null;
  commitment: number | null;
  reservable: number | null;
};

export type QuantityFail = { ok: false; error: string };

function badNumber(n: number): boolean {
  return !Number.isInteger(n);
}

/** O = target + adjustments - recognitions - waivers. C = 미인정·미해제 배정. R = O - C. */
export function evaluateQuantity(input: QuantityInput): QuantityOk | QuantityFail {
  if (input.targetMinutes === null) {
    return { ok: true, pending: true, outstanding: null, commitment: null, reservable: null };
  }
  if (badNumber(input.targetMinutes) || input.targetMinutes < 0) {
    return { ok: false, error: "목표 분량이 올바르지 않습니다" };
  }
  if (badNumber(input.signedAdjustments) || badNumber(input.verifiedRecognitions) || badNumber(input.approvedWaivers)) {
    return { ok: false, error: "분량 조정이 올바르지 않습니다" };
  }
  if (input.verifiedRecognitions < 0 || input.approvedWaivers < 0) {
    return { ok: false, error: "분량 조정이 올바르지 않습니다" };
  }
  let commitment = 0;
  for (const row of input.allocations) {
    if (badNumber(row.minutes) || row.minutes < 0) return { ok: false, error: "배정 분량이 올바르지 않습니다" };
    if (!row.recognized && !row.released) commitment += row.minutes;
  }
  const outstanding = input.targetMinutes + input.signedAdjustments - input.verifiedRecognitions - input.approvedWaivers;
  const reservable = outstanding - commitment;
  if (outstanding < 0 || reservable < 0) return { ok: false, error: "남은 분량이 배정량보다 작습니다" };
  return { ok: true, pending: false, outstanding, commitment, reservable };
}

/** 승인 전(target null)에는 새 확정 예약을 열지 않는다. */
export function reserveAllowed(q: QuantityOk, minutes: number): QuantityOk | QuantityFail {
  if (q.pending || q.reservable === null) return { ok: false, error: "분량 승인 전에는 예약을 확정할 수 없습니다" };
  if (badNumber(minutes) || minutes <= 0) return { ok: false, error: "예약 분량이 올바르지 않습니다" };
  if (minutes > q.reservable) return { ok: false, error: "남은 분량보다 많이 예약할 수 없습니다" };
  return q;
}

/** 한 참여에 묶인 배정·인정은 그 학생의 회차 분량을 넘지 않는다. 합반 학생은 더하지 않는다. */
export function participantCap(input: {
  plannedMinutes: number;
  recognizableMinutes: number;
  allocatedMinutes: number;
  recognizedMinutes: number;
}): QuantityOk | QuantityFail {
  if ([input.plannedMinutes, input.recognizableMinutes, input.allocatedMinutes, input.recognizedMinutes].some((n) => badNumber(n) || n < 0)) {
    return { ok: false, error: "참여 분량이 올바르지 않습니다" };
  }
  if (input.allocatedMinutes > input.plannedMinutes || input.recognizedMinutes > input.recognizableMinutes) {
    return { ok: false, error: "한 참여에 배정한 분량이 그 회차를 넘습니다" };
  }
  return { ok: true, pending: false, outstanding: null, commitment: null, reservable: null };
}

/**
 * 노쇼: 그 학생의 미검증 배정만 해제한다. 의무(outstanding)는 유지한다.
 * 부분 검증: 인정분만큼 빼고 잔여 배정은 해제한다. 120 중 60 인정 → O 60, C 0, R 60.
 */
export function releaseUnverified(input: QuantityInput, recognizedNow: number): QuantityInput | QuantityFail {
  if (input.targetMinutes === null) return { ok: false, error: "분량이 정해지기 전에는 인정할 수 없습니다" };
  if (badNumber(recognizedNow) || recognizedNow < 0) return { ok: false, error: "인정 분량이 올바르지 않습니다" };
  const allocations = input.allocations.map((row) => row.recognized ? row : { ...row, released: true });
  return {
    ...input,
    verifiedRecognitions: input.verifiedRecognitions + recognizedNow,
    allocations,
  };
}

/** 반전은 원 인정분만큼 되돌린다. 이미 해제한 배정은 되살리지 않는다. */
export function reverseRecognition(input: QuantityInput, originalRecognized: number): QuantityInput | QuantityFail {
  if (badNumber(originalRecognized) || originalRecognized < 0) {
    return { ok: false, error: "되돌릴 분량이 올바르지 않습니다" };
  }
  if (originalRecognized > input.verifiedRecognitions) {
    return { ok: false, error: "인정된 분량보다 많이 되돌릴 수 없습니다" };
  }
  return { ...input, verifiedRecognitions: input.verifiedRecognitions - originalRecognized };
}

export function closeBlocked(input: {
  liveAllocations: number;
  unverifiedFulfillments: number;
  openReconciliations: number;
  outstanding: number | null;
}): string | null {
  if (input.outstanding === null) return "분량이 정해지기 전에는 종결할 수 없습니다";
  if (input.liveAllocations > 0 || input.unverifiedFulfillments > 0 || input.openReconciliations > 0) {
    return "약속·실시 기록·시수 확인이 남아 있어 종결할 수 없습니다";
  }
  return null;
}
