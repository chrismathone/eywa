import { describe, expect, it } from "vitest";
import { carryShortfall, landedCarryIn, planCarrySessionSync, type CarrySyncRow } from "./carry-session-sync";
import { netAllocatedAmount, type MoneyCarryIn } from "./money-carryover";

const carryIn = (amount: number, over: Partial<MoneyCarryIn> = {}): MoneyCarryIn => ({ amount, fromPeriod: "2026-08", fromClassName: "중등M 개별", note: null, valid: true, ...over });
/** 원장 캡처(9월 홍도연): 예정 5 · 확정 5 · 단가 24,000 · 확정액 120,000 · 배분 120,000 + 8월 이월 24,000 = 실납 144,000. */
const row = (over: Partial<CarrySyncRow> = {}): CarrySyncRow => ({
  termState: "term", pricingMode: "per_session", quantityBasis: "attendance_units",
  confirmedSessions: 5, unitPrice: 24000, amount: 120000, allocatedAmount: 120000, allocationStale: false,
  carryIns: [carryIn(24000)], ...over,
});

describe("금액 이월 → 확정 시수 자동 반영(올리기)", () => {
  it("원장 캡처 — 확정액 120,000 · 실납 144,000(8월 이월 24,000) → 확정 6 · 확정액 144,000", () => {
    expect(planCarrySessionSync(row())).toEqual({ kind: "adjust", sessions: 6, amount: 144000, bySessions: 1, byAmount: 24000 });
  });

  it("🔴 여러 번 불러도 한 번만 — 고친 뒤(확정 6 · 144,000)엔 차이가 0이라 더 올리지 않는다", () => {
    expect(planCarrySessionSync(row({ confirmedSessions: 6, amount: 144000 }))).toEqual({ kind: "none", reason: "balanced" });
  });

  it("🔴 사람이 이미 이월을 넣어 6으로 확정한 줄은 건드리지 않는다(7이 되지 않는다)", () => {
    expect(planCarrySessionSync(row({ confirmedSessions: 6, amount: 144000 }))).toMatchObject({ kind: "none" });
  });

  it("0.5시수 단위 이월은 반영한다", () => {
    expect(planCarrySessionSync(row({ carryIns: [carryIn(12000)] }))).toEqual({ kind: "adjust", sessions: 5.5, amount: 132000, bySessions: 0.5, byAmount: 12000 });
  });

  it("🔴 0.5시수 단위로 안 떨어지는 이월(잔돈)은 시수로 바꾸지 않는다 — 넘긴 돈이 분배에서 빠진다", () => {
    expect(planCarrySessionSync(row({ carryIns: [carryIn(10000)] }))).toEqual({ kind: "none", reason: "not-half" });
    // 단가 25,000에 10,000 = 0.4시수 · 5,000 = 0.2시수 — 소수 한 자리로는 떨어지지만 회차가 아니다(적대 리뷰 2026-10-07).
    const p25 = { unitPrice: 25000, amount: 125000, allocatedAmount: 125000 };
    expect(planCarrySessionSync(row({ ...p25, carryIns: [carryIn(10000)] }))).toEqual({ kind: "none", reason: "not-half" });
    expect(planCarrySessionSync(row({ ...p25, carryIns: [carryIn(5000)] }))).toEqual({ kind: "none", reason: "not-half" });
    expect(planCarrySessionSync(row({ unitPrice: 30000, amount: 150000, allocatedAmount: 150000, carryIns: [carryIn(3000)] }))).toEqual({ kind: "none", reason: "not-half" });
    expect(planCarrySessionSync(row({ ...p25, carryIns: [carryIn(12500)] }))).toMatchObject({ kind: "adjust", sessions: 5.5 });
  });

  it("🔴 이월과 무관하게 어긋나 있던 줄은 건드리지 않는다 — 더 받은 몫이 이월과 다르다", () => {
    // 배분 130,000(확정액보다 10,000 더 받음) + 이월 24,000 → 차이 34,000 ≠ 이월 24,000.
    expect(planCarrySessionSync(row({ allocatedAmount: 130000 }))).toEqual({ kind: "none", reason: "unexplained" });
  });

  it("🔴 자동으로 내리지 않는다 — 덜 받은 줄은 그대로 두고 알릴 금액만 낸다", () => {
    // 이월을 취소한 뒤: 확정 6 · 144,000인데 실납은 120,000.
    const cancelled = row({ confirmedSessions: 6, amount: 144000, carryIns: [] });
    expect(planCarrySessionSync(cancelled)).toEqual({ kind: "none", reason: "unexplained" });
    expect(carryShortfall(cancelled)).toBe(24000);
    // 청구가 4회분(96,000)인데 이월 24,000이 부족을 메워 사람이 5로 확정해 둔 줄 — 이월이 빠져도 4로 깎지 않는다.
    const covered = row({ allocatedAmount: 96000, carryIns: [] });
    expect(planCarrySessionSync(covered)).toMatchObject({ kind: "none" });
    expect(carryShortfall(covered)).toBe(24000);
    // 맞는 줄 · 더 받은 줄 · 판단할 수 없는 줄은 0.
    expect(carryShortfall(row({ confirmedSessions: 6, amount: 144000 }))).toBe(0);
    expect(carryShortfall(row())).toBe(0);
    expect(carryShortfall(row({ allocatedAmount: null }))).toBe(0);
    expect(carryShortfall(row({ allocationStale: true }))).toBe(0);
    expect(carryShortfall(row({ termState: "missing" }))).toBe(0);
  });

  it("🔴 이월이 아직 안 실린 줄은 그대로 — 배분 없음 · 재확인 필요 · 환불 · 보내는 달이 무효 · 받을 줄 없음", () => {
    expect(planCarrySessionSync(row({ allocatedAmount: null }))).toEqual({ kind: "none", reason: "no-allocation" });
    expect(planCarrySessionSync(row({ allocationStale: true }))).toEqual({ kind: "none", reason: "no-allocation" });
    expect(planCarrySessionSync(row({ refundState: "full", allocatedAmount: 0 }))).toMatchObject({ kind: "none" });
    expect(planCarrySessionSync(row({ carryIns: [carryIn(24000, { valid: false })] }))).toEqual({ kind: "none", reason: "balanced" });
    expect(planCarrySessionSync(row({ carryIns: [carryIn(24000, { orphan: true })] }))).toEqual({ kind: "none", reason: "balanced" });
    expect(landedCarryIn(row({ allocationStale: true }))).toBe(0);
    expect(landedCarryIn(row())).toBe(24000);
  });

  it("대상이 아닌 줄 — 미확정 · 가상 행 · 월 정액(EiE) · 옛 일수 기준 · 단가 없음", () => {
    expect(planCarrySessionSync(row({ confirmedSessions: null, amount: null }))).toEqual({ kind: "none", reason: "unconfirmed" });
    expect(planCarrySessionSync(row({ termState: "missing" }))).toEqual({ kind: "none", reason: "not-term" });
    expect(planCarrySessionSync(row({ pricingMode: "monthly" }))).toEqual({ kind: "none", reason: "monthly" });
    expect(planCarrySessionSync(row({ quantityBasis: "days" }))).toEqual({ kind: "none", reason: "days-basis" });
    expect(planCarrySessionSync(row({ unitPrice: null }))).toEqual({ kind: "none", reason: "no-price" });
    expect(planCarrySessionSync(row({ unitPrice: 0 }))).toEqual({ kind: "none", reason: "no-price" });
  });

  it("🔴 이 줄이 다음 달로 보낸 이월이 있으면 올리지 않는다 — 남은 몫을 넘기려고 맞춘 확정이다(연쇄 이월 2026-11-09)", () => {
    // 배분 130,000 · 확정액 120,000 · 받은 이월 24,000 → 10,000을 10월로 보냄. 실납 = 130,000 − 10,000 + 24,000 = 144,000.
    // 받은 이월까지 더 받은 몫으로 세면(2026-11-09) 6으로 올려도 보낸 이월이 유효하지만, 사람이 확정한 시수를 받은 이월만큼 또 올리면
    // 확정이 실제보다 많아진다 — 보낸 이월이 있는 줄은 그대로 둔다(그 전에도 올리면 보낸 이월이 무효가 되어 손대지 않던 줄이다).
    const carryOut = { amount: 10000, toClassId: "c", toClassName: "중등M", toPeriod: "2026-10", note: null, at: null };
    const sending = row({ allocatedAmount: 130000, carryOut });
    expect(planCarrySessionSync(sending)).toEqual({ kind: "none", reason: "sending" });
    // 조은준 9월 모양: 배분 312,000 + 받은 24,000 · 27시수 324,000 → 12,000을 넘김 → 실납 = 확정액(차이 0).
    const jo = row({ unitPrice: 12000, confirmedSessions: 27, amount: 324000, allocatedAmount: 312000, carryOut: { ...carryOut, amount: 12000 } });
    expect(netAllocatedAmount(jo)).toBe(324000);
    expect(planCarrySessionSync(jo)).toEqual({ kind: "none", reason: "balanced" });
    // 이월을 넘기기 전(27시수 · 차이 12,000 ≠ 받은 24,000)에도 올리지 않는다 — 일부만 넘기려는 확정을 되돌리지 않는다.
    expect(planCarrySessionSync({ ...jo, carryOut: null })).toEqual({ kind: "none", reason: "unexplained" });
  });

  it("0~99 밖이 되는 시수는 만들지 않는다", () => {
    expect(planCarrySessionSync(row({ confirmedSessions: 99, amount: 2376000, allocatedAmount: 2376000 }))).toEqual({ kind: "none", reason: "out-of-range" });
  });

  it("확정액이 시수 × 단가가 아닌 옛 줄은 고쳐도 안 맞으므로 그대로 둔다", () => {
    // 확정 5 · 단가 24,000인데 확정액이 119,000(손으로 맞춘 옛 값) · 배분 119,000 + 이월 24,000.
    expect(planCarrySessionSync(row({ amount: 119000, allocatedAmount: 119000 }))).toEqual({ kind: "none", reason: "unexplained" });
  });

  it("🔴 이미 올린 줄에 이월이 더 실리면 — 이월을 방금 저장한 계기에는 늘어난 몫만큼 더 올린다", () => {
    // 확정 6 · 144,000(이월 24,000 반영 끝) → 이월이 48,000으로 늘었다(이번 저장으로 +24,000).
    const again = row({ confirmedSessions: 6, amount: 144000, carryIns: [carryIn(48000)] });
    expect(planCarrySessionSync(again)).toEqual({ kind: "none", reason: "unexplained" }); // 계기를 모르면 그대로(사람이 넣어 둔 줄과 같은 모양)
    expect(planCarrySessionSync(again, 24000)).toEqual({ kind: "adjust", sessions: 7, amount: 168000, bySessions: 1, byAmount: 24000 });
    // 늘어난 몫이 차이와 다르면 · 실린 합계보다 크면(이 줄에 실린 돈이 아니다) · 덜 받은 줄이면 그대로.
    expect(planCarrySessionSync(again, 12000)).toMatchObject({ kind: "none" });
    // (배분 156,000 − 확정액 144,000 = 12,000 더 받음) + 이월 12,000 → 차이 24,000이 늘어난 몫 24,000과 같아 보여도, 이 줄에 실린 이월은 12,000뿐이다.
    expect(planCarrySessionSync(row({ confirmedSessions: 6, amount: 144000, allocatedAmount: 156000, carryIns: [carryIn(12000)] }), 24000)).toMatchObject({ kind: "none" });
    expect(planCarrySessionSync(row({ allocatedAmount: 72000, carryIns: [carryIn(24000)] }), 24000)).toMatchObject({ kind: "none" });
    // 자기 몫을 더 받은 줄(배분 144,000 · 확정액 120,000)에 이월 24,000이 실리면 차이는 48,000 — 어느 쪽과도 안 맞는다.
    expect(planCarrySessionSync(row({ allocatedAmount: 144000 }), 24000)).toEqual({ kind: "none", reason: "unexplained" });
  });

  it("받은 이월이 둘이면 합계로 본다 — 하나만 사람이 넣어 둔 줄은 합계와 달라 건드리지 않는다", () => {
    const two = [carryIn(24000), carryIn(24000, { fromClassName: "중등M 정규" })];
    expect(planCarrySessionSync(row({ carryIns: two }))).toEqual({ kind: "adjust", sessions: 7, amount: 168000, bySessions: 2, byAmount: 48000 });
    expect(planCarrySessionSync(row({ confirmedSessions: 6, amount: 144000, carryIns: two }))).toEqual({ kind: "none", reason: "unexplained" });
  });
});
