import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import AttendanceQuickPage from "@/app/(shell)/attendance/quick/page";

const mocks = vi.hoisted(() => ({ home: vi.fn(), holiday: vi.fn(), lang: vi.fn() }));
vi.mock("@/lib/auth/require-access", () => ({ requireAccess: vi.fn() }));
vi.mock("@/lib/auth/teacher-home", () => ({ teacherViewHome: mocks.home }));
vi.mock("@/features/teacher-view/server/lang", () => ({ getTeacherViewLang: mocks.lang }));
vi.mock("@/features/attendance/live/server/queries", () => ({ getLiveBoard: vi.fn(async () => ({ canEdit: true })) }));
vi.mock("@/features/attendance/live/server/load", () => ({ holidayNameOf: mocks.holiday }));
vi.mock("@/features/attendance/quick/board", () => ({ quickClasses: () => [] }));
vi.mock("@/features/attendance/quick/components/quick-board", () => ({ QuickBoard: () => null }));
vi.mock("@/components/page-header", () => ({ PageHeader: ({ actions }: { actions: ReactNode }) => <header>{actions}</header> }));
afterEach(cleanup);

it.each([false, true])("휴원일(%s)에도 파란 종료 버튼으로 담당 강사의 홈에 돌아간다", async holiday => {
  mocks.home.mockResolvedValue("/onescreen");
  mocks.holiday.mockResolvedValue(holiday ? "휴원" : null);
  mocks.lang.mockResolvedValue("ko");
  render(await AttendanceQuickPage());
  const exit = screen.getByRole("button", { name: "출결 모드 종료" });
  expect(exit).toHaveAttribute("href", "/onescreen");
  expect(exit).toHaveClass("bg-primary");
});

it("영어 강사의 종료 버튼은 영어로 표시하고 ECS 홈을 보존한다", async () => {
  mocks.home.mockResolvedValue("/ecs");
  mocks.holiday.mockResolvedValue(null);
  mocks.lang.mockResolvedValue("en");
  render(await AttendanceQuickPage());
  expect(screen.getByRole("button", { name: "Exit attendance mode" })).toHaveAttribute("href", "/ecs");
});
