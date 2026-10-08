import { describe, expect, it } from "vitest";
import { catalogAuditTarget, diffCatalogItem } from "./catalog-audit";
import { describeTextbookChanges } from "./textbook-audit";

describe("교재 단가표 감사 — 바뀐 칸만, 금액이 맨 앞", () => {
  it("21,000원 → 22,500원(원장 2026-10-08 사례)", () => {
    const changes = diffCatalogItem(
      { title: "초6-1 발전 1권 (22개정)", price: "21000", publisher: null },
      { title: "초6-1 발전 1권 (22개정)", price: "22500", publisher: null },
    );
    expect(describeTextbookChanges(changes)).toBe("금액 21,000원 → 22,500원");
  });
  it("아무것도 안 바뀌면 빈 목록 · 안 보낸 칸은 안 바꾼 것", () => {
    expect(diffCatalogItem({ title: "a", price: 1000 }, { title: "a", price: "1,000" })).toEqual([]);
    expect(diffCatalogItem({ title: "a", publisher: "x" }, { title: "a" })).toEqual([]);
  });
  it("여러 칸 · 비운 칸은 (없음)", () => {
    expect(
      describeTextbookChanges(diffCatalogItem({ title: "a", price: 1000, publisher: "x" }, { title: "b", price: 2000, publisher: "" })),
    ).toBe("금액 1,000원 → 2,000원 · 교재명 a → b · 출판사 x → (없음)");
  });
  it("대상 라벨", () => {
    expect(catalogAuditTarget({ title: " 초6-1 발전 1권 " })).toBe("초6-1 발전 1권");
    expect(catalogAuditTarget({})).toBe("교재 단가표");
  });
});
