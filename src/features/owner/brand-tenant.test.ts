import { describe, expect, it } from "vitest";
import { branchChoices, pickBrandTenantId } from "./brand-tenant";

const A = { id: "a", slug: "injaewon", name: "인재원" };
const B = { id: "b", slug: "injaewon-b", name: "인재원 B지점" };

describe("pickBrandTenantId — 비로그인 브랜드 테넌트(C안: URL에 지점 없음)", () => {
  it("학원이 없으면 null", () => {
    expect(pickBrandTenantId([], "injaewon")).toBeNull();
  });
  it("학원이 정확히 1개면 env 없이도 그 학원(종전 그대로)", () => {
    expect(pickBrandTenantId([A], undefined)).toBe("a");
    expect(pickBrandTenantId([A], "other")).toBe("a");
  });
  it("2개 이상이면 env slug가 가리키는 학원만 — 없으면 제품 중립(null)", () => {
    expect(pickBrandTenantId([A, B], undefined)).toBeNull();
    expect(pickBrandTenantId([A, B], "")).toBeNull();
    expect(pickBrandTenantId([A, B], "nope")).toBeNull();
    expect(pickBrandTenantId([A, B], "injaewon-b")).toBe("b");
  });
  it("🔴 첫 학원을 임의로 고르지 않는다(남의 학원 이름 노출)", () => {
    expect(pickBrandTenantId([B, A], undefined)).toBeNull();
  });
  it("env slug는 공백·대소문자를 관대하게", () => {
    expect(pickBrandTenantId([A, B], "  Injaewon ")).toBe("a");
  });
});

describe("branchChoices — 지점 선택지", () => {
  it("이름순 · 이름이 비면 slug", () => {
    expect(branchChoices([{ id: "z", slug: "z-slug", name: "  " }, A, B])).toEqual([
      { id: "a", name: "인재원" },
      { id: "b", name: "인재원 B지점" },
      { id: "z", name: "z-slug" },
    ]);
  });
});
