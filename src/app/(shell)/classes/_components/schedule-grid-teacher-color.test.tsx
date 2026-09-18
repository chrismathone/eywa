import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScheduleGrid } from "./schedule-grid";

const PERIODS = [
  { id: "1", startTime: "14:20", endTime: "15:00", label: "1교시" },
  { id: "2", startTime: "15:00", endTime: "15:40", label: "2교시" },
];
const CLASS_BG = "#b31b00";

function renderGrid(teacherId: string | null, initial: Parameters<typeof ScheduleGrid>[0]["initial"]) {
  render(
    <form>
      <ScheduleGrid
        weekdayPeriods={PERIODS}
        weekendPeriods={[]}
        initial={initial}
        teacherId={teacherId}
        teacherOptions={[
          { id: "t-yellow", name: "김태건", bgColor: "#ffff00", textColor: "#1d1d1f" },
          { id: "t-green", name: "육소희", bgColor: "#00ad14", textColor: null },
          { id: "t-none", name: "색없음" },
        ]}
        classroomOptions={[]}
        bgColor={CLASS_BG}
        allowSeats
      />
    </form>,
  );
}
/** jsdom은 background를 hex 그대로, color는 rgb()로 돌려준다 — 둘 다 hex로 맞춰 비교한다. */
const toHex = (v: string) => {
  const m = v.match(/^rgb((d+), (d+), (d+))$/);
  return m ? "#" + m.slice(1).map((n) => Number(n).toString(16).padStart(2, "0")).join("") : v.toLowerCase();
};
const bgOf = (name: string) => toHex(screen.getByRole("button", { name }).style.background);
const fgOf = (name: string) => toHex(screen.getByRole("button", { name }).style.color);

describe("반 수정 주간 스케줄 — 강사 칸 = 강사 퍼스널 색, 자리 칸 = 반 색 (원장 2026-09-18)", () => {
  it("교시 담당 강사의 색으로 칠하고, LAB 자리는 반 색으로 칠한다", () => {
    renderGrid(null, [
      { dayOfWeek: "mon", startTime: "14:20", endTime: "15:00", teacherId: "t-yellow" },
      { dayOfWeek: "mon", startTime: "15:00", endTime: "15:40", slotTeacherLabel: "LAB" },
      { dayOfWeek: "tue", startTime: "15:00", endTime: "15:40", teacherId: "t-green" },
    ]);
    expect(bgOf("월 1교시")).toBe("#ffff00");
    expect(fgOf("월 1교시")).toBe("#1d1d1f");
    expect(bgOf("월 2교시")).toBe("#b31b00");
    // 글자색이 비면 바탕에서 읽히는 색을 뽑는다(빈 값으로 두지 않는다).
    expect(bgOf("화 2교시")).toBe("#00ad14");
    expect(fgOf("화 2교시")).not.toBe("");
  });

  it("담당을 비워 둔 칸은 담임의 색", () => {
    renderGrid("t-green", [{ dayOfWeek: "wed", startTime: "14:20", endTime: "15:00" }]);
    expect(bgOf("수 1교시")).toBe("#00ad14");
  });

  it("퍼스널 색이 없는 강사는 반 색", () => {
    renderGrid(null, [{ dayOfWeek: "thu", startTime: "14:20", endTime: "15:00", teacherId: "t-none" }]);
    expect(bgOf("목 1교시")).toBe("#b31b00");
  });
});
