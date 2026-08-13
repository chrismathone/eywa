import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AttendanceAppendix } from "./attendance-appendix";
import type { AttendanceMatrix } from "@/features/attendance/server/queries";

/** 3일짜리 최소 매트릭스 — 출석 1 · 시수 1.5 · 결석 · 미기록을 한 줄에 다 담는다. */
function matrix(over: Partial<AttendanceMatrix> = {}): AttendanceMatrix {
  const days = [
    { date: "2026-08-03", day: 3, dow: 1, label: "월", isWeekend: false, isToday: false },
    { date: "2026-08-04", day: 4, dow: 2, label: "화", isWeekend: false, isToday: false },
    { date: "2026-08-08", day: 8, dow: 6, label: "토", isWeekend: true, isToday: false },
    // 패딩 칸(28일 달의 29~31 같은 것) — 인쇄에선 그리지 않아야 한다
    { date: "pad-32", day: 32, dow: -1, label: "", isWeekend: false, isToday: false, placeholder: true },
  ];
  return {
    classes: [],
    selectedClassId: "c1",
    month: "2026-08",
    window: { kind: "month", scope: null, start: "2026-08-01", end: "2026-08-31", label: "2026년 8월", defId: null },
    days,
    classDows: [1, 2],
    students: [
      { id: "s1", name: "김학생", grade: "중2", school: "경명여중", enrolledAt: null, attendDows: [1, 2], spans: [] },
      { id: "s2", name: "이학생", grade: "중1", school: "침산중", enrolledAt: null, attendDows: [1], spans: [] },
    ],
    marks: {
      s1: { "2026-08-03": "present", "2026-08-04": "absent", "2026-08-08": "present" },
      s2: { "2026-08-03": "present" },
    },
    notes: {},
    units: { s1: { "2026-08-08": 1.5 } },
    slots: {},
    derived: {},
    derivedActive: false,
    stats: {
      totalStudents: 2,
      presentRate: 0,
      presentCount: 0,
      absentCount: 0,
      lateCount: 0,
      makeupCount: 0,
      totalRecords: 0,
    },
    ...over,
  } as AttendanceMatrix;
}

const groups = [{ classId: "c1", className: "중등M TP2A", matrix: matrix() }];

describe("급여명세서 별지 — 그 달 출석부", () => {
  it("가로 용지 페이지 박스를 쓴다(세로 A4엔 31일 격자가 안 들어간다)", () => {
    const { container } = render(<AttendanceAppendix groups={groups} period="2026-08" teacherName="김윤하" />);
    expect(container.querySelector(".print-landscape")).toBeTruthy();
  });

  it("칸 값 = 급여가 센 시수 · 결석은 'ㆍ' · 미기록은 빈칸", () => {
    render(<AttendanceAppendix groups={groups} period="2026-08" teacherName="김윤하" />);
    // s1: 8/3 출석(1) · 8/4 결석(ㆍ) · 8/8 출석 1.5시수
    expect(screen.getByText("1.5")).toBeTruthy();
    expect(screen.getAllByText("ㆍ")).toHaveLength(1);
    // 결석이 '0'으로 찍히면 격자가 0으로 덮인다 — 그러면 안 된다
    expect(screen.queryByText("0")).toBeNull();
  });

  it("학생별 시수 합 = 그 학생 칸의 합(명세서 '총 시수'와 맞물리는 값)", () => {
    render(<AttendanceAppendix groups={groups} period="2026-08" teacherName="김윤하" />);
    // s1 = 1 + 0 + 1.5 = 2.5 · s2 = 1 · 합계 3.5
    expect(screen.getByText("2.5")).toBeTruthy();
    expect(screen.getByText("3.5")).toBeTruthy();
  });

  it("패딩 칸(그 달에 없는 날)은 인쇄에 안 그린다", () => {
    const { container } = render(<AttendanceAppendix groups={groups} period="2026-08" teacherName="김윤하" />);
    const headers = [...container.querySelectorAll("thead th")].map((th) => th.textContent);
    expect(headers).toEqual(["학생", "3", "4", "8", "시수"]);
    expect(headers).not.toContain("32");
  });

  it("담당 반이 없으면 별지 자체를 만들지 않는다(빈 장 방지)", () => {
    const { container } = render(<AttendanceAppendix groups={[]} period="2026-08" teacherName="김윤하" />);
    expect(container.innerHTML).toBe("");
  });

  it("학생이 없는 반은 표를 그리지 않는다", () => {
    const empty = [{ classId: "c2", className: "빈 반", matrix: matrix({ students: [] }) }];
    render(<AttendanceAppendix groups={empty} period="2026-08" teacherName="김윤하" />);
    expect(screen.queryByText("빈 반")).toBeNull();
  });

  it("머리글에 연월과 강사 이름을 밝힌다(별지만 떨어져도 누구 것인지 알게)", () => {
    render(<AttendanceAppendix groups={groups} period="2026-08" teacherName="김윤하" />);
    expect(screen.getByText(/2026년 8월 출석부 — 김윤하/)).toBeTruthy();
  });
});
