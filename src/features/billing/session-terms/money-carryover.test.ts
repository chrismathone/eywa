import { describe, expect, it } from "vitest";
import { canReceiveCarry, carryBlocksSplits, carryInTotal, carryLanding, carryOutValid, carrySurplus, carryTargetRank, isCarryColumnMissing, netAllocatedAmount, receivedCarry, validateMoneyCarry, type MoneyCarryIn, type MoneyCarryOut } from "./money-carryover";
import { invoiceAllocationStates, type AllocationTermRow } from "./allocation-state";

// 김지호 2026-09 모양 — 수업 청구 169,375원 한 줄을 '고등M 개별 토' 63,750 · '고등M_일 개별진도' 105,625로 나눴는데
// 개별진도의 확정액은 95,625원(4.5시수 × 21,250) — 10,000원을 더 받았다(원장 2026-09-21 "만원 남은걸 다음달로").
const extra = { allocatedAmount: 105625, allocationStale: false, amount: 95625, confirmedSessions: 4.5 };
const out = (amount: number): MoneyCarryOut => ({ amount, toClassId: "c-oct", toClassName: "고등M_일 개별진도", toPeriod: "2026-10", note: null, at: null });
const inn = (amount: number, extraFields: Partial<MoneyCarryIn> = {}): MoneyCarryIn => ({ amount, fromPeriod: "2026-09", fromClassName: "고등M_일 개별진도", note: null, valid: true, ...extraFields });

describe("금액 이월 — 더 받은 몫", () => {
  it("확정액보다 더 받은 몫만 넘길 수 있다", () => {
    expect(carrySurplus(extra)).toBe(10000);
    expect(carrySurplus({ ...extra, allocatedAmount: 95625 })).toBe(0);
    expect(carrySurplus({ ...extra, allocatedAmount: 90000 })).toBe(0); // 덜 받은 쪽은 이월 재원이 아니다
  });
  it("배분 재확인·미확정·배분 없음·전액 환불(배분 0)이면 넘길 몫이 없다", () => {
    expect(carrySurplus({ ...extra, allocationStale: true })).toBe(0);
    expect(carrySurplus({ ...extra, confirmedSessions: null })).toBe(0);
    expect(carrySurplus({ ...extra, amount: null })).toBe(0);
    expect(carrySurplus({ ...extra, allocatedAmount: null })).toBe(0);
    expect(carrySurplus({ ...extra, allocatedAmount: 0 })).toBe(0);
  });
  it("저장한 이월은 지금도 더 받은 몫 안에 있을 때만 유효하다 — 배분을 다시 저장해 줄면 무효", () => {
    expect(carryOutValid(extra, 10000)).toBe(true);
    expect(carryOutValid(extra, 4000)).toBe(true);
    expect(carryOutValid(extra, 10001)).toBe(false);
    expect(carryOutValid({ ...extra, allocatedAmount: 100000 }, 10000)).toBe(false);
    expect(carryOutValid(extra, 0)).toBe(false);
  });
});

describe("금액 이월 — 실납(분배·표시 공통)", () => {
  it("보낸 달은 이월만큼 줄고, 받은 달은 이월만큼 는다", () => {
    expect(netAllocatedAmount({ ...extra, carryOut: out(10000) })).toBe(95625);
    expect(netAllocatedAmount({ allocatedAmount: 85625, allocationStale: false, amount: 95625, confirmedSessions: 4.5, carryIns: [inn(10000)] })).toBe(95625);
  });
  it("무효한 이월은 어느 쪽에도 실리지 않는다 — 한쪽만 실리면 같은 돈이 두 번(또는 0번) 분배된다", () => {
    expect(netAllocatedAmount({ ...extra, carryOut: out(20000) })).toBe(105625);
    expect(netAllocatedAmount({ ...extra, carryIns: [inn(5000, { valid: false })] })).toBe(105625);
  });
  it("받을 반 줄이 없어 옮겨 붙인 이월(orphan)은 더하지 않는다", () => {
    expect(carryInTotal([inn(10000, { orphan: true }), inn(3000)])).toBe(3000);
  });
  it("배분이 아직 없으면 실납도 없다 — 받은 이월은 배분을 저장해야 실린다", () => {
    expect(netAllocatedAmount({ allocatedAmount: null, amount: 95625, confirmedSessions: 4.5, carryIns: [inn(10000)] })).toBeNull();
  });
  it("전액 환불 줄엔 받은 이월을 싣지 않는다 — 환불로 만든 배분 0은 저장된 배분이 아니다(적대 리뷰 2026-09-21)", () => {
    expect(netAllocatedAmount({ allocatedAmount: 0, amount: 95625, confirmedSessions: 4.5, refundState: "full", carryIns: [inn(10000)] })).toBe(0);
  });
  it("받을 줄이 없는 이월(보낸 쪽 orphan · 받는 쪽 orphan)은 분배 저장을 막는다 — 무효한 이월은 안 막는다", () => {
    expect(carryBlocksSplits({ ...extra, carryOut: { ...out(10000), landing: "orphan" } })).toBe(true);
    expect(carryBlocksSplits({ ...extra, carryOut: { ...out(10000), landing: "waiting" } })).toBe(false);
    expect(carryBlocksSplits({ ...extra, carryOut: { ...out(20000), landing: "orphan" } })).toBe(false); // 무효 = 어차피 안 뺀다
    expect(carryBlocksSplits({ ...extra, carryIns: [inn(5000, { orphan: true })] })).toBe(true);
    expect(carryBlocksSplits({ ...extra, carryIns: [inn(5000, { orphan: true, valid: false })] })).toBe(false);
  });
  it("이월이 없으면 배분액 그대로다", () => {
    expect(netAllocatedAmount(extra)).toBe(105625);
    expect(netAllocatedAmount({ ...extra, carryOut: null, carryIns: [] })).toBe(105625);
  });
});

describe("연쇄 이월 — 받은 이월에서 남은 몫도 다음 달로(원장 2026-11-09)", () => {
  // 조은준 9월 '중등E_중1 SKY' — 배분 312,000(26시수) + 8월 이월 24,000 = 실납 336,000 · 확정 27시수 324,000 → 12,000 남음.
  const sep = { allocatedAmount: 312000, allocationStale: false, amount: 324000, confirmedSessions: 27, carryIns: [inn(24000, { fromPeriod: "2026-08" })] };
  it("받은 이월도 더 받은 몫에 든다 — 배분액만 보면 0원이라 '이월' 버튼이 안 섰다", () => {
    expect(carrySurplus({ ...sep, carryIns: undefined })).toBe(0);
    expect(carrySurplus(sep)).toBe(12000);
    expect(receivedCarry(sep)).toBe(24000);
  });
  it("남은 12,000을 넘기면 9월 실납 = 확정액 · 그보다 많이는 무효", () => {
    expect(carryOutValid(sep, 12000)).toBe(true);
    expect(netAllocatedAmount({ ...sep, carryOut: out(12000) })).toBe(324000);
    expect(carryOutValid(sep, 12001)).toBe(false);
    expect(netAllocatedAmount({ ...sep, carryOut: out(12001) })).toBe(336000);
  });
  it("받은 이월이 무효·옮겨 붙음(orphan)이거나 이 줄이 받을 수 없으면(재확인·환불) 더 받은 몫에 안 든다 — 실납과 같은 판정", () => {
    expect(carrySurplus({ ...sep, carryIns: [inn(24000, { valid: false })] })).toBe(0);
    expect(carrySurplus({ ...sep, carryIns: [inn(24000, { orphan: true })] })).toBe(0);
    expect(carrySurplus({ ...sep, allocationStale: true })).toBe(0);
    expect(carrySurplus({ ...sep, refundedAllocation: true, allocatedAmount: 0 })).toBe(0);
  });
});

describe("🔴 받는 달·보낸 달이 같은 규칙 — 받을 수 있는 줄 · 붙일 줄 · 도착 상태(재리뷰 2026-09-21)", () => {
  const ok = { allocatedAmount: 85625, allocationStale: false, amount: 95625, confirmedSessions: 4.5 };
  const cases: [string, Parameters<typeof canReceiveCarry>[0], boolean][] = [
    ["유효 배분", ok, true],
    ["배분 없음", { ...ok, allocatedAmount: null }, false],
    ["재확인", { ...ok, allocationStale: true }, false],
    ["반 이름으로 잡힌 전액 환불", { ...ok, allocatedAmount: 0, refundState: "full" }, false],
    ["공유 줄 전액 환불(반 이름으론 안 잡힘)", { ...ok, allocatedAmount: 0, refundState: "none", refundedAllocation: true }, false],
    ["0원으로 저장한 연결 없음 반은 받는다", { ...ok, allocatedAmount: 0 }, true],
  ];
  for (const [name, row, expected] of cases) {
    it(`받을 수 있나: ${name} → ${expected}`, () => {
      expect(canReceiveCarry(row)).toBe(expected);
      // 받는 달 실납에 실제로 더해지는지와 같은 답이어야 한다.
      expect(netAllocatedAmount({ ...row, carryIns: [inn(10000)] })).toBe(row.allocatedAmount == null ? null : row.allocatedAmount + (expected ? 10000 : 0));
    });
  }
  it("붙일 줄 순서: 받을 수 있는 줄 → 환불 아닌 회차 행 → 가상 행 → 환불 줄", () => {
    expect(carryTargetRank({ ...ok, termState: "term" })).toBe(0);
    expect(carryTargetRank({ ...ok, allocatedAmount: null, termState: "term" })).toBe(1);
    expect(carryTargetRank({ ...ok, allocatedAmount: null, termState: "missing" })).toBe(2);
    expect(carryTargetRank({ ...ok, allocatedAmount: 0, refundState: "full", termState: "term" })).toBe(3);
  });
  it("도착 상태: 받을 수 있는 회차 행이면 landed · 회차 행이 전부 환불이거나 줄이 없으면 orphan · 그 밖 waiting", () => {
    expect(carryLanding([ok], false)).toBe("landed");
    expect(carryLanding([{ ...ok, allocatedAmount: null }], false)).toBe("waiting");
    expect(carryLanding([{ ...ok, allocatedAmount: 0, refundedAllocation: true }], true)).toBe("orphan");
    expect(carryLanding([{ ...ok, allocatedAmount: 0, refundState: "full" }, { ...ok, allocatedAmount: null }], false)).toBe("waiting");
    expect(carryLanding([], true)).toBe("waiting");
    expect(carryLanding([], false)).toBe("orphan");
  });
});

describe("0278a 미적용 판별 — 실패와 '이월 없음'을 가른다", () => {
  it("컬럼 없음(42703)·스키마 캐시(PGRST204) 문구는 미적용", () => {
    expect(isCarryColumnMissing("fetchAllPaged: column invoice_session_terms.allocation_carry_out does not exist")).toBe(true);
    expect(isCarryColumnMissing("fetchInChunks: Could not find the 'allocation_carry_out' column of 'invoice_session_terms' in the schema cache")).toBe(true);
  });
  it("권한·시간 초과·다른 컬럼 오류는 실패(삼키지 않는다)", () => {
    expect(isCarryColumnMissing("fetchAllPaged: permission denied for table invoice_session_terms")).toBe(false);
    expect(isCarryColumnMissing("fetchAllPaged: canceling statement due to statement timeout")).toBe(false);
    expect(isCarryColumnMissing("fetchAllPaged: column invoices.period does not exist")).toBe(false);
  });
});

describe("금액 이월 — 저장 입력 검증", () => {
  const limits = { surplus: 10000, classIds: ["c-oct", "c-oct2"] };
  it("원 단위 · 더 받은 몫 이하 · 다음 달 반만", () => {
    expect(validateMoneyCarry({ amount: 10000, classId: "c-oct", note: null }, limits)).toEqual({ ok: true });
    expect(validateMoneyCarry({ amount: 10001, classId: "c-oct", note: null }, limits).ok).toBe(false);
    expect(validateMoneyCarry({ amount: 100.5, classId: "c-oct", note: null }, limits).ok).toBe(false);
    expect(validateMoneyCarry({ amount: -1, classId: "c-oct", note: null }, limits).ok).toBe(false);
    expect(validateMoneyCarry({ amount: 5000, classId: "other", note: null }, limits).ok).toBe(false);
    expect(validateMoneyCarry({ amount: 5000, classId: null, note: null }, limits).ok).toBe(false);
  });
  it("0원 = 취소 — 반·더 받은 몫과 무관하게 통과한다", () => {
    expect(validateMoneyCarry({ amount: 0, classId: null, note: null }, { surplus: 0, classIds: [] })).toEqual({ ok: true });
  });
  it("메모 길이 상한", () => {
    expect(validateMoneyCarry({ amount: 1000, classId: "c-oct", note: "가".repeat(201) }, limits).ok).toBe(false);
  });
});

describe("배분 판정 한 벌(invoiceAllocationStates) — 회차 확정 면과 금액 이월(받는 달)이 같이 쓴다", () => {
  const line = { kind: "수업", description: "수학 수강료", amount: 169375 };
  const inv = { id: "i1", line_items: [line], status: "paid" };
  const term = (id: string, amount: number, allocated: number, cls = "고등M 개별 토"): AllocationTermRow => ({
    id, class_id: `c-${id}`, className: cls, amount, confirmed_sessions: 3,
    allocation_line_index: 0, allocation_amount: allocated, allocation_source: line, allocation_base_amount: amount,
  });
  it("합계가 맞는 배분은 유효, 받은 이월 판정에 그대로 쓴다", () => {
    const states = invoiceAllocationStates(inv, [term("a", 63750, 63750), term("b", 95625, 105625, "고등M_일 개별진도")]);
    expect(states.get("b")).toMatchObject({ allocatedAmount: 105625, allocationStale: false, fullyRefunded: false });
    const b = states.get("b")!;
    expect(carryOutValid({ ...b, amount: 95625, confirmedSessions: 3 }, 10000)).toBe(true);
  });
  it("청구 항목이 바뀌면(합계 불일치) 재확인 — 이월도 무효", () => {
    const changed = { ...inv, line_items: [{ ...line, amount: 170000 }] };
    const states = invoiceAllocationStates(changed, [term("a", 63750, 63750), term("b", 95625, 105625)]);
    expect(states.get("b")).toMatchObject({ allocatedAmount: null, allocationStale: true });
    expect(carryOutValid({ ...states.get("b")!, amount: 95625, confirmedSessions: 3 }, 10000)).toBe(false);
  });
  it("여러 반이 나누는 한 줄이 전액 환불되면 반 이름 매칭과 무관하게 '환불로 만든 0'이다", () => {
    const refunded = { ...line, refunds: [{ status: "active", type: "full", amount: 169375 }] };
    const states = invoiceAllocationStates({ ...inv, line_items: [refunded] }, [
      { ...term("a", 63750, 63750), allocation_source: refunded }, { ...term("b", 95625, 105625, "고등M_일 개별진도"), allocation_source: refunded },
    ]);
    const b = states.get("b")!;
    expect(b.allocatedAmount).toBe(0);
    expect(b.refundedAllocation).toBe(true);
    expect(canReceiveCarry({ ...b, amount: 95625, confirmedSessions: 3 })).toBe(false);
  });
  it("청구서 전액 환불이면 배분 0 — 이월 무효", () => {
    const states = invoiceAllocationStates({ ...inv, status: "refunded" }, [term("a", 63750, 63750), term("b", 95625, 105625)]);
    expect(states.get("b")).toMatchObject({ allocatedAmount: 0, fullyRefunded: true, allocationStale: false });
    expect(carryOutValid({ ...states.get("b")!, amount: 95625, confirmedSessions: 3 }, 10000)).toBe(false);
  });
  it("배분을 저장한 적 없는 청구서의 미확정 반은 재확인이 아니다", () => {
    const states = invoiceAllocationStates(inv, [{ ...term("a", 63750, 0), allocation_line_index: null, allocation_amount: null, allocation_source: null, allocation_base_amount: null, confirmed_sessions: null }]);
    expect(states.get("a")).toMatchObject({ allocatedAmount: null, allocationStale: false });
  });
});
