import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/features/owner/defaults";
import { GENERIC_SETTINGS } from "@/features/owner/generic-defaults";
import { isPayrollEnabled, isStaffLeavesEnabled } from "./config";

describe("지점별 급여·기존 휴가 기능", () => {
  it("침산은 기존의 숨김 결정을 유지한다", () => {
    expect(isPayrollEnabled(DEFAULT_SETTINGS)).toBe(false);
    expect(isStaffLeavesEnabled(DEFAULT_SETTINGS)).toBe(false);
  });

  it("일반 지점은 웹앱 모듈 설정으로 두 기능을 각각 제어한다", () => {
    expect(isPayrollEnabled(GENERIC_SETTINGS)).toBe(false);
    expect(isStaffLeavesEnabled(GENERIC_SETTINGS)).toBe(false);
    const enabled = { ...GENERIC_SETTINGS, modules: { disabled: GENERIC_SETTINGS.modules.disabled.filter(
      id => id !== "payroll" && id !== "staff_leaves",
    ) } };
    expect(isPayrollEnabled(enabled)).toBe(true);
    expect(isStaffLeavesEnabled(enabled)).toBe(true);
  });
});
