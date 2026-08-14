import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SeatDayTable } from "./seat-day-table";
import type { SeatDayStudent } from "../server/seat-day-types";
import type { SheetHandlers } from "./sheet-client";

vi.mock("@/components/workspace/window-link", () => ({
  WindowLink: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("./attendance-check", () => ({ AttendanceCheck: () => <span>출결칸</span> }));
vi.mock("./attitude-check", () => ({ AttitudeCheck: () => <span>태도칸</span> }));
vi.mock("@/features/onescreen/components/attendance-pills", () => ({
  SessionUnitsField: () => <span>유닛칸</span>,
}));

afterEach(cleanup);

const student: SeatDayStudent = {
  studentId: "s1",
  classId: "c1",
  className: "중등E_초등 브릿지 A",
  name: "김수민",
  englishName: null,
  school: null,
  grade: null,
  eligible: true,
  historical: false,
  endedOn: null,
  mark: null,
  attendance: null,
  canMarkAttendance: true,
  canEditMark: true,
};

describe("305 합명단 표", () => {
  it("JJ 폼 머리 — 듣기 레벨·누적 암기 단어수, 시험 점수 없음", () => {
    render(
      <SeatDayTable
        date="2026-08-14"
        slotStart="16:20"
        form="selfStudy"
        students={[student]}
        handlersOf={() => ({}) as SheetHandlers}
        collapsedGroups={[]}
        onToggleGroup={() => undefined}
      />,
    );
    expect(screen.getByText("듣기 레벨")).toBeInTheDocument();
    expect(screen.getByText("누적 암기 단어수")).toBeInTheDocument();
    expect(screen.queryByText("시험 점수")).not.toBeInTheDocument();
    expect(screen.getByText("김수민")).toBeInTheDocument();
    expect(screen.getByText("초등 브릿지 A")).toBeInTheDocument();
  });
});
