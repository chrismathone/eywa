import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_PERIODS_CONFIG } from "@/features/timetable/lib/periods";
import type { SubjectMaps } from "@/features/owner/subjects";
import type { WeekGridRow } from "@/features/students/lib/week-grid";
import { cellBlockHeight } from "@/features/students/lib/week-grid-row-height";
import { StudentPeriodGrid } from "./student-period-grid";

afterEach(cleanup);

const subjects: SubjectMaps = {
  labelOf: (k) => k,
  colorOf: () => "rose",
  options: [{ value: "english", label: "영어" }],
  filters: [],
};

const rows: WeekGridRow[] = [
  {
    classId: "c1",
    subject: "english",
    className: "PL1a",
    teacherName: "육소희",
    slots: [
      { day: "mon", startTime: "14:20", endTime: "15:00", periodLabel: "", room: "본원602", teacherName: "육소희" },
      { day: "tue", startTime: "14:20", endTime: "15:00", periodLabel: "", seat: "LAB" },
      { day: "mon", startTime: "15:00", endTime: "15:40", periodLabel: "", room: "본원602", seat: "LAB" },
      { day: "mon", startTime: "15:40", endTime: "16:20", periodLabel: "", room: "본원603" },
    ],
  },
];

describe("StudentPeriodGrid 행 높이", () => {
  it("세 줄(반·담당·방) 칸이 옛 46px보다 큰 행에 들어간다", () => {
    const { container } = render(
      <StudentPeriodGrid
        rows={rows}
        subject="english"
        config={DEFAULT_PERIODS_CONFIG}
        subjects={subjects}
        tableHeight={1}
        rowMode="used"
      />,
    );
    expect(screen.getAllByText("육소희").length).toBeGreaterThan(0);
    expect(screen.getAllByText("본원602").length).toBeGreaterThan(0);
    expect(screen.getAllByText("LAB").length).toBeGreaterThan(0);
    const hs = [...container.querySelectorAll("tbody tr")].map((tr) => Number.parseFloat((tr as HTMLElement).style.height));
    expect(hs.length).toBe(3);
    const need = cellBlockHeight({
      classId: "c1", className: "PL1a", teacherName: "육소희", subject: "english",
      room: "본원602", seat: null, startTime: "14:20", endTime: "15:00",
    });
    expect(Math.min(...hs)).toBeGreaterThanOrEqual(need);
    expect(Math.min(...hs)).toBeGreaterThan(46);
  });
});
