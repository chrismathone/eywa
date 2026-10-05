import { describe, expect, it } from "vitest";
import { closeBlocked, evaluateQuantity, participantCap, releaseUnverified, reserveAllowed, reverseRecognition } from "./quantity";

const base = { targetMinutes: 120, signedAdjustments: 0, verifiedRecognitions: 0, approvedWaivers: 0, allocations: [] as { minutes: number; recognized: boolean; released: boolean }[] };
const capError = "참여 분량이 올바르지 않습니다";
const overCap = "한 참여에 배정한 분량이 그 회차를 넘습니다";

describe("분량", () => {
  it("승인 전 목표는 비어 있고 확정 예약을 열지 않는다", () => {
    const pending = evaluateQuantity({ ...base, targetMinutes: null });
    expect(pending).toMatchObject({ ok: true, pending: true, outstanding: null, reservable: null });
    if (pending.ok) expect(reserveAllowed(pending, 30).ok).toBe(false);
  });

  it("음수는 0으로 숨기지 않는다", () => {
    expect(evaluateQuantity({ ...base, targetMinutes: -1 }).ok).toBe(false);
    expect(evaluateQuantity({ ...base, verifiedRecognitions: -5 }).ok).toBe(false);
    expect(evaluateQuantity({ ...base, allocations: [{ minutes: -1, recognized: false, released: false }] }).ok).toBe(false);
  });

  it("120 중 60 인정·60 해제면 잔여 60, 점유 0", () => {
    const released = releaseUnverified({ ...base, allocations: [{ minutes: 120, recognized: false, released: false }] }, 60);
    expect("ok" in released).toBe(false);
    if (!("ok" in released)) {
      const next = evaluateQuantity(released);
      expect(next).toMatchObject({ outstanding: 60, commitment: 0, reservable: 60 });
    }
  });

  it("반전은 원 인정분만 되돌리고 해제한 배정은 되살리지 않는다", () => {
    const reversed = reverseRecognition({ ...base, verifiedRecognitions: 60, allocations: [{ minutes: 60, recognized: false, released: true }] }, 60);
    expect(reversed).toMatchObject({ verifiedRecognitions: 0, allocations: [{ released: true }] });
  });

  it("한 참여의 배정은 그 회차를 넘지 않고, 열린 대사가 있으면 종결하지 않는다", () => {
    expect(participantCap({ plannedMinutes: 60, recognizableMinutes: 60, allocatedMinutes: 90, recognizedMinutes: 0 }).ok).toBe(false);
    expect(closeBlocked({ liveAllocations: 1, unverifiedFulfillments: 0, openReconciliations: 0, outstanding: 0 })).toBeTruthy();
    expect(closeBlocked({ liveAllocations: 0, unverifiedFulfillments: 0, openReconciliations: 0, outstanding: 0 })).toBeNull();
  });

  it("네 분량이 모두 음수여도 상한 비교를 통과하면 거절한다", () => {
    expect(participantCap({
      plannedMinutes: -30,
      recognizableMinutes: -10,
      allocatedMinutes: -40,
      recognizedMinutes: -20,
    })).toEqual({ ok: false, error: capError });
  });

  it("음수 회차 분량은 초과가 아니라 잘못된 분량으로 거절한다", () => {
    expect(participantCap({
      plannedMinutes: -30,
      recognizableMinutes: 60,
      allocatedMinutes: 0,
      recognizedMinutes: 0,
    })).toEqual({ ok: false, error: capError });
  });

  it("승인 전 null은 옆의 잘못된 분량을 보지 않는다", () => {
    const pending = evaluateQuantity({
      ...base,
      targetMinutes: null,
      signedAdjustments: -999,
      verifiedRecognitions: -5,
      approvedWaivers: 1.5,
      allocations: [{ minutes: -1, recognized: false, released: false }],
    });
    expect(pending).toEqual({ ok: true, pending: true, outstanding: null, commitment: null, reservable: null });
    if (pending.ok) {
      expect(reserveAllowed(pending, 30)).toEqual({ ok: false, error: "분량 승인 전에는 예약을 확정할 수 없습니다" });
    }
  });

  it("의무·점유·예약가능을 같은 분으로 계산하고 음수 잔량은 거절한다", () => {
    const live = evaluateQuantity({
      ...base,
      signedAdjustments: -20,
      verifiedRecognitions: 30,
      approvedWaivers: 10,
      allocations: [
        { minutes: 40, recognized: false, released: false },
        { minutes: 15, recognized: true, released: false },
        { minutes: 25, recognized: false, released: true },
      ],
    });
    expect(live).toEqual({ ok: true, pending: false, outstanding: 60, commitment: 40, reservable: 20 });
    if (live.ok) {
      expect(reserveAllowed(live, 20)).toEqual(live);
      expect(reserveAllowed(live, 21)).toEqual({ ok: false, error: "남은 분량보다 많이 예약할 수 없습니다" });
      expect(reserveAllowed(live, 0)).toEqual({ ok: false, error: "예약 분량이 올바르지 않습니다" });
      expect(reserveAllowed(live, 1.5)).toEqual({ ok: false, error: "예약 분량이 올바르지 않습니다" });
    }
    expect(evaluateQuantity({ ...base, targetMinutes: 1.5 })).toEqual({ ok: false, error: "목표 분량이 올바르지 않습니다" });
    expect(evaluateQuantity({ ...base, signedAdjustments: -1.5 })).toEqual({ ok: false, error: "분량 조정이 올바르지 않습니다" });
    expect(evaluateQuantity({ ...base, approvedWaivers: -1 })).toEqual({ ok: false, error: "분량 조정이 올바르지 않습니다" });
    expect(evaluateQuantity({ ...base, allocations: [{ minutes: 130, recognized: false, released: false }] })).toEqual({ ok: false, error: "남은 분량이 배정량보다 작습니다" });
    expect(evaluateQuantity({ ...base, verifiedRecognitions: 200 })).toEqual({ ok: false, error: "남은 분량이 배정량보다 작습니다" });
  });

  it("노쇼는 미검증 배정만 풀고 이미 인정한 줄과 의무는 남긴다", () => {
    expect(releaseUnverified({ ...base, targetMinutes: null }, 0)).toEqual({ ok: false, error: "분량이 정해지기 전에는 인정할 수 없습니다" });
    expect(releaseUnverified(base, -1)).toEqual({ ok: false, error: "인정 분량이 올바르지 않습니다" });
    expect(releaseUnverified(base, 1.2)).toEqual({ ok: false, error: "인정 분량이 올바르지 않습니다" });
    const noshow = releaseUnverified({
      ...base,
      allocations: [
        { minutes: 80, recognized: false, released: false },
        { minutes: 40, recognized: true, released: false },
      ],
    }, 0);
    expect(noshow).toEqual({
      ...base,
      allocations: [
        { minutes: 80, recognized: false, released: true },
        { minutes: 40, recognized: true, released: false },
      ],
    });
    if (!("ok" in noshow)) {
      expect(evaluateQuantity(noshow)).toMatchObject({ outstanding: 120, commitment: 0, reservable: 120 });
    }
  });

  it("해제는 잔량 불변식을 대신 검사하지 않는다", () => {
    const over = releaseUnverified(base, 200);
    expect("ok" in over).toBe(false);
    if (!("ok" in over)) expect(evaluateQuantity(over)).toEqual({ ok: false, error: "남은 분량이 배정량보다 작습니다" });
  });

  it("같은 인정분은 한 번만 되돌리고 둘째 요청은 거절한다", () => {
    const once = reverseRecognition({ ...base, verifiedRecognitions: 60, allocations: [{ minutes: 60, recognized: false, released: true }] }, 60);
    expect(once).toMatchObject({ verifiedRecognitions: 0, allocations: [{ minutes: 60, released: true }] });
    if (!("ok" in once)) {
      expect(reverseRecognition(once, 60)).toEqual({ ok: false, error: "인정된 분량보다 많이 되돌릴 수 없습니다" });
    }
    expect(reverseRecognition(base, 1)).toEqual({ ok: false, error: "인정된 분량보다 많이 되돌릴 수 없습니다" });
    expect(reverseRecognition(base, -5)).toEqual({ ok: false, error: "되돌릴 분량이 올바르지 않습니다" });
    expect(reverseRecognition(base, 0.5)).toEqual({ ok: false, error: "되돌릴 분량이 올바르지 않습니다" });
  });

  it("참여 상한은 그 학생 회차와 같고 0분은 허용한다", () => {
    expect(participantCap({ plannedMinutes: 60, recognizableMinutes: 50, allocatedMinutes: 60, recognizedMinutes: 50 })).toEqual({
      ok: true, pending: false, outstanding: null, commitment: null, reservable: null,
    });
    expect(participantCap({ plannedMinutes: 0, recognizableMinutes: 0, allocatedMinutes: 0, recognizedMinutes: 0 }).ok).toBe(true);
    expect(participantCap({ plannedMinutes: 60, recognizableMinutes: 50, allocatedMinutes: 0, recognizedMinutes: 51 })).toEqual({ ok: false, error: overCap });
    expect(participantCap({ plannedMinutes: 1.5, recognizableMinutes: 0, allocatedMinutes: 0, recognizedMinutes: 0 })).toEqual({ ok: false, error: capError });
    expect(participantCap({ plannedMinutes: Number.NaN, recognizableMinutes: 0, allocatedMinutes: 0, recognizedMinutes: 0 })).toEqual({ ok: false, error: capError });
    expect(participantCap({ plannedMinutes: Number.POSITIVE_INFINITY, recognizableMinutes: 0, allocatedMinutes: 0, recognizedMinutes: 0 })).toEqual({ ok: false, error: capError });
  });

  it("종결은 분량이 비었거나 약속·실시·확인이 남아 있으면 막는다", () => {
    const blocked = "약속·실시 기록·시수 확인이 남아 있어 종결할 수 없습니다";
    expect(closeBlocked({ liveAllocations: 0, unverifiedFulfillments: 0, openReconciliations: 0, outstanding: null })).toBe("분량이 정해지기 전에는 종결할 수 없습니다");
    expect(closeBlocked({ liveAllocations: 0, unverifiedFulfillments: 2, openReconciliations: 0, outstanding: 0 })).toBe(blocked);
    expect(closeBlocked({ liveAllocations: 0, unverifiedFulfillments: 0, openReconciliations: 1, outstanding: 40 })).toBe(blocked);
    expect(closeBlocked({ liveAllocations: 0, unverifiedFulfillments: 0, openReconciliations: 0, outstanding: 40 })).toBeNull();
  });
});
