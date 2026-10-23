import { describe, expect, it } from "vitest";
import { formatBizNo, formatPhone, matchesVendorCategory, matchesVendorQuery, NO_CATEGORY, telHref, vendorCategoryChips } from "./vendor";

const row = (p: Partial<Parameters<typeof matchesVendorQuery>[0]> = {}) => ({
  name: "대구서점", category: "서점", phone: "053-312-4567", contactName: "김담당", contactPhone: "010-1234-5678",
  email: null, address: "대구 북구 침산로 1", bizNo: "123-45-67890", note: null, ...p,
});

describe("업체리스트 검색", () => {
  it("이름·분류·담당자·주소를 공백·대소문자 무시로", () => {
    expect(matchesVendorQuery(row(), "대구 서점")).toBe(true);
    expect(matchesVendorQuery(row(), "김담당")).toBe(true);
    expect(matchesVendorQuery(row(), "침산로")).toBe(true);
    expect(matchesVendorQuery(row(), "정수기")).toBe(false);
  });
  it("번호는 숫자만 비교 — 하이픈 없이 쳐도 찾는다", () => {
    expect(matchesVendorQuery(row(), "0533124")).toBe(true);
    expect(matchesVendorQuery(row(), "12345678")).toBe(true);
    expect(matchesVendorQuery(row(), "1234567890")).toBe(true);
  });
  it("숫자 두 자리 이하는 번호 검색으로 안 본다", () => {
    expect(matchesVendorQuery(row({ name: "가" , address: null, bizNo: null }), "45")).toBe(false);
  });
  it("빈 검색어 = 전부", () => {
    expect(matchesVendorQuery(row(), "  ")).toBe(true);
  });
});

describe("분류 칩 — 데이터에서 나온다", () => {
  it("많이 쓰인 순 → 가나다, 미분류는 맨 뒤", () => {
    const chips = vendorCategoryChips([{ category: "출판사" }, { category: "서점" }, { category: "서점" }, { category: null }, { category: "정수기" }]);
    expect(chips.map((c) => c.label)).toEqual(["서점", "정수기", "출판사", "미분류"]);
    expect(chips[0]!.count).toBe(2);
  });
  it("분류가 하나도 없으면 칩도 없다(미분류 칩 혼자 서지 않는다)", () => {
    expect(vendorCategoryChips([{ category: null }])).toEqual([]);
  });
  it("필터", () => {
    expect(matchesVendorCategory({ category: "서점" }, "서점")).toBe(true);
    expect(matchesVendorCategory({ category: null }, NO_CATEGORY)).toBe(true);
    expect(matchesVendorCategory({ category: "서점" }, NO_CATEGORY)).toBe(false);
    expect(matchesVendorCategory({ category: "서점" }, null)).toBe(true);
  });
});

describe("번호 다듬기", () => {
  it("숫자만 있으면 하이픈", () => {
    expect(formatPhone("01012345678")).toBe("010-1234-5678");
    expect(formatPhone("0533124567")).toBe("053-312-4567");
    expect(formatPhone("0212345678")).toBe("02-1234-5678");
    expect(formatPhone("021234567")).toBe("02-123-4567");
    expect(formatPhone("15881234")).toBe("1588-1234");
    expect(formatPhone("010 1234 5678")).toBe("010-1234-5678");
  });
  it("글자가 섞였거나 모양을 모르면 그대로", () => {
    expect(formatPhone("053-312-4567 (내선 23)")).toBe("053-312-4567 (내선 23)");
    expect(formatPhone("12345")).toBe("12345");
  });
  it("사업자등록번호", () => {
    expect(formatBizNo("1234567890")).toBe("123-45-67890");
    expect(formatBizNo("123-45-67890")).toBe("123-45-67890");
    expect(formatBizNo("미발급")).toBe("미발급");
  });
  it("tel 링크", () => {
    expect(telHref("053-312-4567")).toBe("tel:0533124567");
    expect(telHref("내선 23")).toBeNull();
    expect(telHref(null)).toBeNull();
  });
});
