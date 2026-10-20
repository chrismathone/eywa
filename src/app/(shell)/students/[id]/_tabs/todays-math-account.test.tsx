import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/license/server", () => ({ isFeatureOptedIn: vi.fn() }));
vi.mock("@/features/students/server/queries", () => ({ getStudentById: vi.fn() }));
vi.mock("@/features/integrations/todays-math/sync-server", () => ({ sourceBindingForTenant: vi.fn(), targetRequest: vi.fn() }));
import { TodaysMathAccountCard } from "./todays-math-account";

it("says 미발급 and where to issue when there is no account", () => {
  render(<dl><TodaysMathAccountCard account={null} /></dl>);
  expect(screen.getByText("미발급")).toBeTruthy();
  expect(screen.getByText("오늘 수학에서 발급해요")).toBeTruthy();
});

it("shows the state and whether the student has logged in", () => {
  const { rerender } = render(<dl><TodaysMathAccountCard account={{ state: "active", issuedAt: "2026-10-01T00:00:00.000Z", lastLoginAt: null }} /></dl>);
  expect(screen.getByText("발급됨")).toBeTruthy();
  expect(screen.getByText("아직 로그인 전이에요")).toBeTruthy();
  rerender(<dl><TodaysMathAccountCard account={{ state: "disabled", issuedAt: "2026-10-01T00:00:00.000Z", lastLoginAt: "2026-10-02T09:30:00.000Z" }} /></dl>);
  expect(screen.getByText("꺼짐")).toBeTruthy();
  expect(screen.getByText(/마지막 로그인/)).toBeTruthy();
  expect(screen.getByText(/2026/)).toBeTruthy();
});

it("translates the fixed words for the English teacher view (lookup trims, so keys carry no edge spaces)", async () => {
  const { sheetUiText } = await import("@/features/teacher-view/interface-text");
  expect(sheetUiText("en", "마지막 로그인 ")).toBe("Last login ");
  expect(sheetUiText("en", "미발급")).toBe("Not issued");
  expect(sheetUiText("en", "만점이 달라 못 채우는 칸 ")).toBe("Different full marks, not filled: ");
});
