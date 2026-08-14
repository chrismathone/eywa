import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AttendanceAppendix } from "./attendance-appendix";
import type { AttendanceMatrix } from "@/features/attendance/server/queries";

/**
 * 별지는 **출석부 화면과 같은 서식**이어야 한다(원장 지시 "따로 서식 두지 말고").
 * 그래서 이 테스트는 "내가 정한 표기"가 아니라 화면 규약(cell-display.ts)이 그대로 나오는지를 본다 —
 * 결석은 `0`, 이름 옆 표식은 신입/퇴원.
 */
function matrix(over: Partial<AttendanceMatrix> = {}): AttendanceMatrix {
  const days = [
    { date: "2026-08-03", day: 3, dow: 1, label: "월", isWeekend: false, isToday: false },
    { date: "2026-08-04", day: 4, dow: 2, label: "화", isWeekend: false, isToday: false },
    { date: "2026-08-08", day: 8, dow: 6, label: "토", isWeekend: true, isToday: false },
    // 패딩 칸(그 달에 없는 날) — 인쇄에선 안 그린다
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
      {
        id: "s1", name: "김학생", grade: "중2", school: "경명여중", enrolledAt: null,
        attendDows: [1, 2], spans: [{ start: "2026-01-01", end: null }],
      },
      // 그 달 안에 끝난 수강 = 퇴원
      {
        id: "s2", name: "이퇴원", grade: "중1", school: "침산중", enrolledAt: null,
        attendDows: [1], spans: [{ start: "2026-01-01", end: "2026-08-20" }],
      },
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
    stats: { totalStudents: 2, presentRate: 0, presentCount: 0, absentCount: 0, lateCount: 0, makeupCount: 0, totalRecords: 0 },
    ...over,
  } as AttendanceMatrix;
}

const groups = [{ classId: "c1", className: "중등M TP2A", matrix: matrix() }];
const render1 = (over: Partial<Parameters<typeof AttendanceAppendix>[0]> = {}) =>
  render(<AttendanceAppendix groups={groups} period="2026-08" teacherName="김윤하" holidays={{}} {...over} />);

describe("급여명세서 별지 — 그 달 출석부", () => {
  it("가로 용지 페이지 박스를 쓴다(세로 A4엔 31일 격자가 안 들어간다)", () => {
    const { container } = render1();
    expect(container.querySelector(".print-landscape")).toBeTruthy();
  });

  it("열 구성이 출석부 화면과 같다 — 이름·학교학년·날짜(요일)·시수·출석", () => {
    const { container } = render1();
    const headers = [...container.querySelectorAll("thead th")].map((th) => th.textContent);
    expect(headers).toEqual(["이름", "학교·학년", "3월", "4화", "8토", "시수", "출석"]);
    expect(headers.join()).not.toContain("32");
  });

  it("칸 표기는 화면 규약 그대로 — 결석은 0(임의 기호를 쓰지 않는다)", () => {
    render1();
    expect(screen.getByText("1.5")).toBeTruthy(); // 시수 배수
    expect(screen.getAllByText("0").length).toBeGreaterThanOrEqual(1); // 결석
  });

  it("🔑 반별 퇴원 확인 — 이름 옆 표식 + 반 머리 요약 둘 다(원장 요청)", () => {
    render1();
    expect(screen.getAllByText("퇴원").length).toBeGreaterThanOrEqual(1); // 이름 옆 표식
    expect(screen.getByText(/퇴원 1명 · 이퇴원/)).toBeTruthy(); // 반 머리 요약
  });

  it("퇴원자가 없으면 반 머리에 퇴원 줄을 안 만든다", () => {
    const noLeave = [
      {
        classId: "c9",
        className: "퇴원없는반",
        matrix: matrix({
          students: [
            {
              id: "s1", name: "김학생", grade: "중2", school: "경명여중", enrolledAt: null,
              attendDows: [1], spans: [{ start: "2026-01-01", end: null }],
            },
          ] as AttendanceMatrix["students"],
        }),
      },
    ];
    render1({ groups: noLeave });
    expect(screen.queryByText(/퇴원 \d+명/)).toBeNull();
  });

  it("학교·학년은 압축 표기를 쓴다(공백 join 금지 규약)", () => {
    render1();
    expect(screen.getByText("경명여중2")).toBeTruthy();
  });

  it("담당 반이 없거나 명단이 빈 반만 있으면 별지 자체를 안 만든다(빈 장 방지)", () => {
    expect(render1({ groups: [] }).container.innerHTML).toBe("");
    const empty = [{ classId: "c2", className: "빈 반", matrix: matrix({ students: [] }) }];
    expect(render1({ groups: empty }).container.innerHTML).toBe("");
  });

  it("공휴일은 날짜 머리에 이름을 달고 빨간 글자로(화면과 같은 규칙)", () => {
    const { container } = render1({ holidays: { "2026-08-03": "광복절 대체" } });
    const th = [...container.querySelectorAll("thead th")].find((e) => e.textContent === "3월");
    expect(th?.getAttribute("title")).toBe("광복절 대체");
    expect(th?.className).toContain("text-rose-600");
  });

  it("머리글에 연월과 강사 이름을 밝힌다(별지만 떨어져도 누구 것인지 알게)", () => {
    render1();
    expect(screen.getByText(/2026년 8월 출석부 — 김윤하/)).toBeTruthy();
    expect(screen.getByText(/칸의 숫자 = 그날 인정된 수업 시수/)).toBeTruthy();
  });

  it("caption을 바꾸면 급여 문구는 안 나오고 새 문구가 선다(랩실 별지)", () => {
    render1({ caption: "자리 표시가 있는 확정 기록만 시수 열에 넣습니다" });
    expect(screen.queryByText(/급여 산정에 들어간 값/)).toBeNull();
    expect(screen.getByText(/자리 표시가 있는 확정 기록만/)).toBeTruthy();
  });

  it("unitsByStudent가 있으면 시수 열만 덮는다(확정·확인을 섞지 않으려고)", () => {
    render1({ unitsByStudent: { s1: 7, s2: 11 } });
    expect(screen.getByText("7")).toBeTruthy();
    expect(screen.getByText("11")).toBeTruthy();
  });
});
