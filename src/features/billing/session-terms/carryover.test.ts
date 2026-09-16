import { describe, expect, it } from "vitest";
import { classifyVerification } from "./verification";
import {
  maxCarryoverOut,
  maxCarryoverIn,
  payrollCapSessions,
  payableSessions,
  validateCarryover,
} from "./carryover";

const v = (confirmed: number | null, actual: number) => classifyVerification(confirmed, actual);

describe("maxCarryoverOut — 넘길 수 있는 재원은 '그 달 부족분'뿐", () => {
  it("부족(청구 8·실측 7)이면 1회", () => {
    expect(maxCarryoverOut(v(8, 7))).toBe(1);
  });
  it("일치면 0", () => {
    expect(maxCarryoverOut(v(8, 8))).toBe(0);
  });
  it("⚠️ 초과(더 가르침)를 이월 재원으로 둔갑시키지 않는다 — 0", () => {
    expect(maxCarryoverOut(v(8, 9))).toBe(0);
  });
  it("미확정이면 0", () => {
    expect(maxCarryoverOut(v(null, 7))).toBe(0);
  });
  it("출석부의 0.5시수 부족분도 보존한다", () => {
    expect(maxCarryoverOut(v(8, 7.5))).toBe(0.5);
    expect(maxCarryoverOut(v(8, 6.5))).toBe(1.5);
    expect(maxCarryoverIn(v(8, 8.5), 1.5)).toBe(0.5);
    expect(payableSessions(9, 8, 0.5)).toBe(8.5);
  });
});

describe("maxCarryoverIn — 초과분이 있고 크레딧이 있을 때만", () => {
  it("초과 1회 + 크레딧 1회 → 1", () => {
    expect(maxCarryoverIn(v(8, 9), 1)).toBe(1);
  });
  it("초과 2회인데 크레딧 1회 → 1(크레딧이 상한)", () => {
    expect(maxCarryoverIn(v(8, 10), 1)).toBe(1);
  });
  it("⚠️ 크레딧 0이면 초과가 있어도 0 — 기록 없는 초과는 절대 인정 안 함", () => {
    expect(maxCarryoverIn(v(8, 9), 0)).toBe(0);
  });
  it("초과가 없으면 크레딧이 있어도 0(크레딧을 헛되이 태우지 않음)", () => {
    expect(maxCarryoverIn(v(8, 8), 3)).toBe(0);
    expect(maxCarryoverIn(v(8, 7), 3)).toBe(0);
  });
});

describe("payableSessions — 원장 제약: 더한 수업은 절대 급여에 안 들어간다", () => {
  it("이월 없이 더 가르치면 상한(청구)까지만", () => {
    expect(payableSessions(9, 8, 0)).toBe(8);
  });
  it("이월 1회가 기록돼 있으면 9회까지 인정", () => {
    expect(payableSessions(9, 8, 1)).toBe(9);
  });
  it("이월이 있어도 실제로 안 가르쳤으면 실측까지만", () => {
    expect(payableSessions(8, 8, 1)).toBe(8);
  });
  it("덜 가르치면 자동으로 실측까지만(이월 없이도)", () => {
    expect(payableSessions(7, 8, 0)).toBe(7);
  });
  it("실측 미기록이면 상한을 쓴다 — 0으로 지어내지 않음", () => {
    expect(payableSessions(null, 8, 0)).toBe(8);
  });
  it("미확정이면 null(산정 보류)", () => {
    expect(payableSessions(9, null, 0)).toBeNull();
  });

  it("🔒 불변식: 두 달 합쳐 지급 ≤ 수납 (원장 예시 5월 결석 → 6월 보강)", () => {
    // 5월: 청구 8·실측 7 → 부족 1을 이월. 6월: 청구 8·실측 9 → 크레딧 1로 9 인정.
    const may = v(8, 7);
    const carried = maxCarryoverOut(may); // 1
    const mayPaid = payableSessions(7, 8, 0); // 7
    const jun = v(8, 9);
    const used = maxCarryoverIn(jun, carried); // 1
    const junPaid = payableSessions(9, 8, used); // 9
    expect(carried).toBe(1);
    expect(mayPaid).toBe(7);
    expect(junPaid).toBe(9);
    expect(mayPaid! + junPaid!).toBe(16); // 지급 16
    expect(8 + 8).toBe(16); // 수납 16 → 손해 0
  });

  it("🔒 불변식: 이월을 기록하지 않으면 강사가 1회 손해(현 동작) — 기록이 곧 지급 허가", () => {
    const mayPaid = payableSessions(7, 8, 0); // 7
    const junPaid = payableSessions(9, 8, 0); // 8 (9회째 잘림)
    expect(mayPaid! + junPaid!).toBe(15);
  });
});

describe("payrollCapSessions", () => {
  it("상한 = 확정 + 이월", () => {
    expect(payrollCapSessions(8, 1)).toBe(9);
    expect(payrollCapSessions(8, 0)).toBe(8);
  });
  it("미확정이면 null", () => {
    expect(payrollCapSessions(null, 1)).toBeNull();
  });
});

describe("validateCarryover — 서버 재검증(마지막 방어선)", () => {
  it("한도 안이면 통과", () => {
    expect(validateCarryover({ out: 1 }, { maxOut: 1, maxIn: 0 })).toEqual({ ok: true, out: 1, in: 0 });
  });
  it("⚠️ 크레딧 없이 상한을 올리려 하면 거절", () => {
    const r = validateCarryover({ in: 1 }, { maxOut: 0, maxIn: 0 });
    expect(r.ok).toBe(false);
  });
  it("부족분보다 많이 넘기려 하면 거절", () => {
    const r = validateCarryover({ out: 3 }, { maxOut: 1, maxIn: 0 });
    expect(r.ok).toBe(false);
  });
  it("음수·소수 두 자리부터 거절하고 소수 한 자리는 허용", () => {
    expect(validateCarryover({ out: -1 }, { maxOut: 5, maxIn: 5 }).ok).toBe(false);
    expect(validateCarryover({ in: 1.55 }, { maxOut: 5, maxIn: 5 }).ok).toBe(false);
    expect(validateCarryover({ in: 1.5 }, { maxOut: 5, maxIn: 5 }).ok).toBe(true);
  });
});
