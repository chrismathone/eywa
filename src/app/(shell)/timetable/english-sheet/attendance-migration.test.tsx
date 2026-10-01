import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { AttendanceMigrationPreview } from "./attendance-migration";
import { wholeAbsenceFixture } from "@/features/timetable/import/master/attendance-absence-fixture";
import { planAttendanceMigration } from "@/features/timetable/import/master/attendance-migration";
afterEach(cleanup);
it("학생별 이전 반·교시와 변경 반·교시, 유지 건수를 구분한다", () => {
  render(
    <AttendanceMigrationPreview
      migration={{
        retainedCells: 2,
        moves: [
          {
            ids: ["a", "revision"],
            studentId: "s1",
            studentName: "김하나",
            date: "2026-10-01",
            fromClassId: "old",
            fromClassName: "PL1",
            fromTime: "14:20",
            toClassId: "new",
            toClassName: "PL2",
            toTime: "15:00",
          },
        ],
      }}
    />,
  );
  const section = screen.getByRole("region", { name: "기존 출결 이관" });
  expect(
    within(section).getByText(/이관 1칸 · 같은 반·교시에서 유지 2칸/),
  ).toBeVisible();
  expect(within(section).getByText("PL1 · 14:20")).toBeVisible();
  expect(within(section).getByText("PL2 · 15:00")).toBeVisible();
  expect(within(section).getByRole("link", { name: "김하나" })).toHaveAttribute(
    "href",
    "/students/s1",
  );
  expect(within(section).getAllByRole("row")).toHaveLength(2);
});

it("전교시 사전 결석은 이전 3칸과 새 2칸을 하나의 묶음으로 설명한다", () => {
  const { plan, ctx } = wholeAbsenceFixture();
  render(
    <AttendanceMigrationPreview
      migration={planAttendanceMigration(plan, ctx)}
    />,
  );
  const section = screen.getByRole("region", { name: "기존 출결 이관" });
  expect(within(section).getAllByRole("row")).toHaveLength(2);
  expect(within(section).getByText(/이관 2칸/)).toBeVisible();
  expect(within(section).getByText(/전교시 사전 결석 3칸 → 2칸/)).toBeVisible();
  expect(
    within(section).getByText(/이전반 · 18:20 · 19:20 · 20:20/),
  ).toBeVisible();
  expect(within(section).getByText(/PL2 · 17:20 · 18:20/)).toBeVisible();
  expect(within(section).getByText(/원본 기록은 모두 보존/)).toBeVisible();
});
