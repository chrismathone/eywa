import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/license/server", () => ({ isFeatureOptedIn: vi.fn() }));
vi.mock("@/features/students/server/queries", () => ({ getStudentById: vi.fn() }));
vi.mock("@/features/integrations/todays-math/sync-server", () => ({ sourceBindingForTenant: vi.fn(), targetRequest: vi.fn() }));
import { TodaysMathRecentTests } from "./todays-math-recent-tests";

const base = { kind: "daily", title: null, unitName: "일차방정식", testDate: "2026-10-01", sourceClassId: null, className: "중2A", questionCount: 5 };

it("shows score with the house test notation, and words for absent / not graded instead of a zero", () => {
  render(<TodaysMathRecentTests tests={[
    { ...base, testId: "a", kind: "monthly", title: "10월 월말평가", result: null },
    { ...base, testId: "b", result: { absent: true, takenAt: "2026-10-01T01:00:00.000Z" } },
    { ...base, testId: "c", result: { absent: false, score: 80, correctCount: 4, takenAt: "2026-10-01T01:00:00.000Z" } },
    { ...base, testId: "d", kind: "weekly_quiz", result: { absent: false, score: null, correctCount: null, takenAt: "2026-10-01T01:00:00.000Z" } },
  ]} />);
  expect(screen.getByText("월말평가")).toBeTruthy();
  expect(screen.getByText("10월 월말평가")).toBeTruthy();
  expect(screen.getByText("채점 전")).toBeTruthy();
  expect(screen.getByText("결시")).toBeTruthy();
  expect(screen.getByText("80점")).toBeTruthy();
  expect(screen.getByText("5문제 중 4개 맞음")).toBeTruthy();
  expect(screen.getByText("점수 없음")).toBeTruthy();
  expect(screen.queryByText("weekly_quiz")).toBeNull();
  expect(screen.queryByText("0점")).toBeNull();
});

it("says so when nothing is assigned", () => {
  render(<TodaysMathRecentTests tests={[]} />);
  expect(screen.getByText("아직 배정된 시험이 없어요.")).toBeTruthy();
});
