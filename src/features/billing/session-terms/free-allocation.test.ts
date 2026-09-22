import { describe, expect, it } from "vitest";
import { canUseFreeAllocation, freeAllocationSaveRows, freeSavedInvoiceIds, freeShapeSaved, initialFreeAmounts, validateFreeAllocation } from "./free-allocation";

// 자유 배분(원장 2026-09-21): "총 금액(청구액)은 변하지 않는선에서 출결행에 다 분배" · "관리자 이상급" · "받은 돈보다 더 지급할 순 없다 · 덜 지급하는건 괜찮다".
const terms = [
  { id: "a", className: "고등M 개별 토", confirmedSessions: 3, pricingMode: "per_session" },
  { id: "b", className: "고등M_일 개별진도", confirmedSessions: 4.5, pricingMode: "per_session" },
  { id: "c", className: "보강", confirmedSessions: null, pricingMode: "per_session" },
];

describe("자유 배분 — 누가", () => {
  it("관리자 이상(원장·관리자)만 — 매니저·회계·강사는 아니다", () => {
    expect(canUseFreeAllocation("master")).toBe(true);
    expect(canUseFreeAllocation("admin")).toBe(true);
    expect(canUseFreeAllocation("manager")).toBe(false);
    expect(canUseFreeAllocation("accountant")).toBe(false);
    expect(canUseFreeAllocation("teacher")).toBe(false);
  });
});

describe("자유 배분 — 저장된 모양", () => {
  it("연결 행이 없고 금액 있는 연결 없는 행이 있어야 자유 배분이다 — '연결 안 함 0원'만 있으면 아니다", () => {
    expect(freeShapeSaved([{ allocationLineIndex: null, savedAllocationAmount: 50000 }, { allocationLineIndex: null, savedAllocationAmount: null }])).toBe(true);
    expect(freeShapeSaved([{ allocationLineIndex: null, savedAllocationAmount: 0 }])).toBe(false);
    expect(freeShapeSaved([{ allocationLineIndex: 0, savedAllocationAmount: 50000 }, { allocationLineIndex: null, savedAllocationAmount: 10000 }])).toBe(false);
  });
  it("그 달 전체 행을 청구서별로 접는다 — 청구서 없는 줄은 건너뛴다", () => {
    const ids = freeSavedInvoiceIds([
      { invoiceId: "i1", allocationLineIndex: null, savedAllocationAmount: 50000 },
      { invoiceId: "i1", allocationLineIndex: null, savedAllocationAmount: null },
      { invoiceId: "i2", allocationLineIndex: 1, savedAllocationAmount: 50000 },
      { invoiceId: "i2", allocationLineIndex: null, savedAllocationAmount: 7000 },
      { invoiceId: null, allocationLineIndex: null, savedAllocationAmount: 9000 },
    ]);
    expect([...ids]).toEqual(["i1"]);
  });
});

describe("자유 배분 — 받은 돈보다 더 못 준다 · 덜 주는 건 괜찮다", () => {
  it("합계가 수업 청구액 이하면 통과(덜 줘도 된다)", () => {
    expect(validateFreeAllocation(terms, [{ termId: "a", amount: 63750 }, { termId: "b", amount: 95625 }, { termId: "c", amount: 10000 }], 169375)).toEqual({ ok: true, sum: 169375 });
    expect(validateFreeAllocation(terms, [{ termId: "a", amount: 60000 }, { termId: "b", amount: 90000 }], 169375)).toEqual({ ok: true, sum: 150000 });
  });
  it("합계가 청구액을 넘으면 거절 — 문구에 두 금액을 밝힌다", () => {
    const r = validateFreeAllocation(terms, [{ termId: "a", amount: 100000 }, { termId: "b", amount: 100000 }], 169375);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/169,375원.*200,000원/);
  });
  it("확정한 반은 모두 넣어야 한다 · 미확정 반은 금액을 적었을 때만 · 0시수 확정 반엔 못 준다 · 음수·소수 거절", () => {
    expect(validateFreeAllocation(terms, [{ termId: "a", amount: 1000 }], 169375).ok).toBe(false);
    expect(validateFreeAllocation(terms, [{ termId: "a", amount: 0 }, { termId: "b", amount: 0 }, { termId: "c", amount: 0 }], 169375).ok).toBe(false);
    const zero = [{ ...terms[0], confirmedSessions: 0 }, terms[1]];
    expect(validateFreeAllocation(zero, [{ termId: "a", amount: 1 }, { termId: "b", amount: 0 }], 169375).ok).toBe(false);
    expect(validateFreeAllocation(terms, [{ termId: "a", amount: -1 }, { termId: "b", amount: 0 }], 169375).ok).toBe(false);
    expect(validateFreeAllocation(terms, [{ termId: "a", amount: 1.5 }, { termId: "b", amount: 0 }], 169375).ok).toBe(false);
  });
});

describe("자유 배분 — 저장 행·처음 값", () => {
  it("확정한 반은 빈칸이면 0원으로, 미확정 반은 금액을 적었을 때만 싣는다", () => {
    expect(freeAllocationSaveRows(terms, { a: "63750", b: "", c: "" })).toEqual([{ termId: "a", amount: 63750 }, { termId: "b", amount: 0 }]);
    expect(freeAllocationSaveRows(terms, { a: "1", b: "2", c: "3" })).toEqual([{ termId: "a", amount: 1 }, { termId: "b", amount: 2 }, { termId: "c", amount: 3 }]);
  });
  it("자동 배분이 먼저 — 항목별 초안의 금액으로 시작하고, 이미 자유 배분이면 저장값으로", () => {
    const draft = { a: { line: "0", amount: "63750" }, b: { line: "0", amount: "105625" }, c: { line: "", amount: "" } };
    expect(initialFreeAmounts(terms, draft, false)).toEqual({ a: "63750", b: "105625", c: "" });
    expect(initialFreeAmounts(terms.map((t) => ({ ...t, savedAllocationAmount: t.id === "c" ? 10000 : 50000 })), draft, true)).toEqual({ a: "50000", b: "50000", c: "10000" });
  });
  it("🔴 무효가 된 자유 배분도 저장했던 원값으로 연다 — 빈칸(= 확정 반 0원)으로 열면 한 번 눌러 전부 0원이 된다", () => {
    // 유효값(allocatedAmount)은 무효라 null이지만 원값(savedAllocationAmount)은 남아 있다.
    const stale = terms.map((t) => ({ ...t, allocatedAmount: null, savedAllocationAmount: t.id === "a" ? 70000 : null }));
    expect(initialFreeAmounts(stale, {}, true)).toEqual({ a: "70000", b: "0", c: "" });
  });
  it("🔴 전액 환불한 반에는 금액을 줄 수 없다 — 0원은 괜찮다", () => {
    const refunded = terms.map((t) => (t.id === "b" ? { ...t, fullyRefunded: true } : t));
    expect(validateFreeAllocation(refunded, [{ termId: "a", amount: 100000 }, { termId: "b", amount: 1 }], 300000)).toMatchObject({ ok: false, error: expect.stringContaining("전액 환불") });
    expect(validateFreeAllocation(refunded, [{ termId: "a", amount: 100000 }, { termId: "b", amount: 0 }], 300000)).toMatchObject({ ok: true });
  });
});
