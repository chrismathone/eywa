import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import AttendanceQuickPage from "@/app/(shell)/attendance/quick/page";

const mocks = vi.hoisted(() => ({ home: vi.fn(), holiday: vi.fn(), lang: vi.fn(), activity: vi.fn() }));
vi.mock("@/lib/auth/require-access", () => ({ requireAccess: vi.fn() }));
vi.mock("@/lib/auth/teacher-home", () => ({ teacherViewHome: mocks.home }));
vi.mock("@/features/teacher-view/server/lang", () => ({ getTeacherViewLang: mocks.lang }));
vi.mock("@/features/attendance/live/server/queries", () => ({ getLiveBoard: vi.fn(async () => ({ canEdit: true })) }));
vi.mock("@/features/attendance/live/server/load", () => ({ holidayNameOf: mocks.holiday }));
// 휴원일 화면의 읽기 전용 입력 요약(2026-10-03) — 내 수업만 범위로 묻는다.
vi.mock("@/features/attendance/server/holiday-activity", () => ({ getHolidayDayActivity: mocks.activity }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: async () => ({ operations: { subjects: [] } }) }));
vi.mock("@/features/attendance/quick/board", () => ({ quickClasses: () => [] }));
vi.mock("@/features/attendance/quick/components/quick-board", () => ({ QuickBoard: () => null }));
vi.mock("@/components/page-header", () => ({ PageHeader: ({ actions }: { actions: ReactNode }) => <header>{actions}</header> }));
afterEach(cleanup);

it.each([false, true])("휴원일(%s)에도 파란 종료 버튼으로 담당 강사의 홈에 돌아간다", async holiday => {
  mocks.home.mockResolvedValue("/onescreen");
  mocks.holiday.mockResolvedValue(holiday ? "휴원" : null);
  mocks.lang.mockResolvedValue("ko");
  mocks.activity.mockResolvedValue({ date: "2026-10-03", students: 0, classes: 0, cells: 0, reservations: 0, excludedTestCells: 0, rows: [], officeScope: false });
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

it("휴원일 화면은 내 수업만 범위의 입력 기록을 읽기 전용으로 보여 주고 월별 출석부로 보낸다(일별 링크 없음)", async () => {
  mocks.home.mockResolvedValue("/onescreen");
  mocks.holiday.mockResolvedValue("개천절");
  mocks.lang.mockResolvedValue("ko");
  mocks.activity.mockResolvedValue({
    date: "2026-10-03", students: 1, classes: 1, cells: 1, reservations: 0, excludedTestCells: 0, officeScope: false,
    rows: [{ classId: "c1", className: "Bridge A", subject: "english", students: [{ studentId: "s1", name: "김가람", statuses: ["present"] }], reservations: [] }],
  });
  const { container } = render(await AttendanceQuickPage());
  // 범위 = 내 수업만(selfOnly) — 관리자 계열이 열어도 남의 반이 섞이지 않는다.
  expect(mocks.activity).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), true);
  expect(screen.getByText("개천절 — 휴원일")).toBeInTheDocument();
  expect(container.textContent).toContain("입력된 출결 1명 · 1개 반");
  expect(container.textContent).toContain("김가람(출석)");
  const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "");
  expect(hrefs.some((h) => h.startsWith("/attendance?month="))).toBe(true);
  expect(hrefs.some((h) => /^\/attendance\/\d{4}-\d{2}-\d{2}/.test(h))).toBe(false);
  // 분모·완료율이 없다.
  expect(container.textContent).not.toMatch(/\d+\/\d+|%|완료/);
});

it("입력 기록 조회가 실패해도 휴원일 화면은 뜨고, 0명이라고 적지 않는다", async () => {
  mocks.home.mockResolvedValue("/onescreen");
  mocks.holiday.mockResolvedValue("개천절");
  mocks.lang.mockResolvedValue("ko");
  mocks.activity.mockRejectedValue(new Error("boom"));
  const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const { container } = render(await AttendanceQuickPage());
  expect(container.textContent).toContain("이 날 입력된 출결을 불러오지 못했습니다");
  expect(container.textContent).not.toContain("0명");
  spy.mockRestore();
});
