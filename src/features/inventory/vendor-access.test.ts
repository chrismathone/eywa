import { describe, expect, it } from "vitest";
import { canViewVendors } from "./vendor-access";

describe("canViewVendors — 지정한 사람만(원장 역할도 예외 없음, 2026-10-23)", () => {
  it("명단에 있으면 본다", () => expect(canViewVendors("u1", ["u1"])).toBe(true));
  it("명단에 없으면 못 본다", () => expect(canViewVendors("u2", ["u1"])).toBe(false));
  it("명단이 비었거나 저장값이 없으면 아무도 못 본다", () => {
    expect(canViewVendors("u1", [])).toBe(false);
    expect(canViewVendors("u1", undefined)).toBe(false);
  });
  it("깨진 저장값(배열 아님)은 닫는다", () => expect(canViewVendors("u1", "u1" as unknown as string[])).toBe(false));
});
