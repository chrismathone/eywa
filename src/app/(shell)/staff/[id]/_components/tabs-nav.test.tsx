import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { accessibleStaffTab, StaffTabsNav } from "./tabs-nav";
it("개인별 급여 조회 권한이 있을 때만 급여 설정 진입점을 노출한다", () => {
  render(<StaffTabsNav staffId="teacher" active="salary" showActivity={false} showSalarySettings />);
  expect(screen.getByRole("link", { name: "급여 설정" })).toHaveAttribute("href", "/staff/teacher?tab=salary");
  expect(screen.getByRole("link", { name: "급여 설정" })).toHaveAttribute("aria-current", "page");
});
it("권한이 없으면 급여 탭과 직접 URL 진입 모두 기본정보로 가린다", () => {
  render(<StaffTabsNav staffId="teacher" active="info" showActivity={false} />);
  expect(screen.queryByRole("link", { name: "급여 설정" })).not.toBeInTheDocument();
  expect(accessibleStaffTab("salary", { showSalarySettings: false, showActivity: true })).toBe("info");
  expect(accessibleStaffTab("salary", { showSalarySettings: true, showActivity: false })).toBe("salary");
});
