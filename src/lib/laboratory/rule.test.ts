import { describe, expect, it } from "vitest";
import { resolveMatrix, SYSTEM_ROLES } from "@/lib/permissions";
import { SETTINGS_ROLE_KEYS } from "@/lib/settings-role-catalog";
import { capLaboratoryMenus, LAB_ELIGIBLE_KEYS } from "./rule";

describe("실험실 메뉴 권한", () => {
  it("설정 메뉴와 키오스크도 실험실에 지정할 수 있고 복구 화면은 제외한다", () => {
    expect(LAB_ELIGIBLE_KEYS.has("makeups")).toBe(true);
    for (const menu of SETTINGS_ROLE_KEYS) expect(LAB_ELIGIBLE_KEYS.has(menu)).toBe(true);
    expect(LAB_ELIGIBLE_KEYS.has("owner")).toBe(false);
    expect(LAB_ELIGIBLE_KEYS.has("dashboard")).toBe(false);
  });

  it("실험실이 꺼진 학원은 지정된 메뉴만 모든 역할에서 닫힌다", () => {
    const original = resolveMatrix([]);
    const result = capLaboratoryMenus(original, ["makeups"], false);
    for (const role of SYSTEM_ROLES) expect(result.makeups[role]).toBe("none");
    expect(result.students).toEqual(original.students);
    expect(original.makeups.master).not.toBe("none");
  });

  it("실험실을 켜면 메뉴의 기존 권한 설정을 유지한다", () => {
    const original = resolveMatrix([]);
    expect(capLaboratoryMenus(original, ["makeups"], true)).toBe(original);
  });
});
