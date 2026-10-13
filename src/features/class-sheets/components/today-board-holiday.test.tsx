/**
 * ECS 오늘 보드의 일괄 출석 — 휴원일 확인(원장 2026-10-13). 10/9 한글날에 원스크린 일괄로 19명이 '출석'이 된
 * 뒤, 같은 일이 날 수 있는 이 버튼에도 같은 확인을 붙였다. 휴원일에도 수업하는 날이 있어 막지는 않는다.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TodayClassCard } from "../server/today";

const { setAttendanceBulk } = vi.hoisted(() => ({
  setAttendanceBulk: vi.fn(async (input: { cells: { studentId: string; classId: string }[] }) => ({
    applied: input.cells.map((c) => ({ ...c, created: true })),
  })),
}));

vi.mock("@/features/attendance/server/actions", () => ({
  setAttendanceBulk,
  setAttendanceCell: vi.fn(),
}));
vi.mock("../server/actions", () => ({
  clearPresentAttendance: vi.fn(),
  setMyEcsFontSize: vi.fn(async () => ({ ok: true })),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), info: vi.fn() } }));
// 이 시험이 보는 것은 일괄 출석 버튼뿐이다 — 무거운 자식은 빈 껍데기로.
vi.mock("./today-student-row", () => ({ StudentRow: () => null }));
vi.mock("./ecs-makeup-adder", () => ({ EcsMakeupAdder: () => null }));
vi.mock("./today-plan-editor", () => ({ TodayPlanEditor: () => null }));
vi.mock("./today-summary", () => ({ TodaySummary: () => null }));

import { TodayBoard } from "./today-board";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setAttendanceBulk.mockClear();
});

function stubConfirm(answer: boolean) {
  const ask = vi.fn<(message?: string) => boolean>(() => answer);
  vi.stubGlobal("confirm", ask);
  return ask;
}

function student(studentId: string) {
  return {
    studentId,
    attendance: null,
    attendanceNote: null,
    attendanceSlots: [],
    isMakeup: false,
    reportWritten: false,
    marks: {},
  } as unknown as TodayClassCard["students"][number];
}

const CARD = {
  classId: "c1",
  className: "Let's Speak 1",
  teacherName: null,
  startsAt: "16:20",
  endsAt: "17:00",
  slots: [],
  students: ["s1", "s2", "s3"].map(student),
  fill: { total: 1, filled: 0 },
  canMarkAttendance: true,
  delegated: false,
  classnoteToday: "untracked",
  isEie: false,
  shoutingSlots: [],
  hiddenLines: 0,
  hiddenMarks: 0,
} as TodayClassCard;

function renderBoard(holidayName: string | null) {
  render(
    <TodayBoard
      cards={[CARD]}
      date="2026-10-09"
      weekMonday="2026-10-05"
      skillAreas={[]}
      canWrite
      userId="u1"
      tenantId="t1"
      fontSize="sm"
      isToday={false}
      holidayName={holidayName}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "전원 출석 (3명)" }));
}

describe("ECS 오늘 보드 일괄 출석 — 휴원일 확인", () => {
  it("휴원일이면 휴일 이름과 인원을 묻고, 취소하면 아무것도 기록하지 않는다", () => {
    const confirm = stubConfirm(false);
    renderBoard("한글날");
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toContain("학원 휴원일(한글날)");
    expect(confirm.mock.calls[0][0]).toContain("3명");
    expect(setAttendanceBulk).not.toHaveBeenCalled();
    // 낙관 표시도 칠하지 않는다 — 버튼이 그대로 남는다.
    expect(screen.getByRole("button", { name: "전원 출석 (3명)" })).toBeTruthy();
  });

  it("확인하면 그대로 기록한다 — 휴원일에도 입력은 막지 않는다(빈 칸만)", () => {
    stubConfirm(true);
    renderBoard("한글날");
    expect(setAttendanceBulk).toHaveBeenCalledTimes(1);
    const input = setAttendanceBulk.mock.calls[0][0] as { fillEmptyOnly?: boolean; cells: unknown[] };
    expect(input.fillEmptyOnly).toBe(true);
    expect(input.cells).toHaveLength(3);
  });

  it("휴원일이 아니면 종전대로 묻지 않는다", () => {
    const confirm = stubConfirm(true);
    renderBoard(null);
    expect(confirm).not.toHaveBeenCalled();
    expect(setAttendanceBulk).toHaveBeenCalledTimes(1);
  });
});
