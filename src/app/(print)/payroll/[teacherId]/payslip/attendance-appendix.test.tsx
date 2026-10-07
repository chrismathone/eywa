import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AttendanceAppendix } from "./attendance-appendix";
import type { AttendanceMatrix } from "@/features/attendance/server/queries";

/**
 * 별지는 **출석부 화면과 같은 서식**이어야 한다(원장 지시 "따로 서식 두지 말고").
 * 그래서 이 테스트는 "내가 정한 표기"가 아니라 화면 규약(cell-display.ts)이 그대로 나오는지를 본다 —
 * 결석은 `0`.
 * 🔴 급여명세서 별지는 **이름 옆 라벨을 안 단다**(원장 2026-10-07) — 그 달 신입·퇴원만 이름 칸 색으로 말한다.
 *    라벨(신입·퇴원·전입·전출·종강)은 화면과 같은 표를 찍는 반별·자리 출석부 인쇄에만 남는다(`nameStyle="badge"`).
 */
/** 이름 칸(첫 열) — 이름으로 그 줄의 칸을 집는다. */
const nameCell = (container: HTMLElement, name: string) =>
  [...container.querySelectorAll("tbody tr > td:first-child")].find((td) => td.textContent?.includes(name)) as HTMLElement;
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
        attendDows: [1, 2], spans: [{ start: "2026-01-01", end: null }], badges: [],
      },
      // 그 달 안에 끝난 수강 = 퇴원. 🔴 표식은 **매트릭스가 준 값**이다(별지가 다시 계산하지 않는다).
      {
        id: "s2", name: "이퇴원", grade: "중1", school: "침산중", enrolledAt: null,
        attendDows: [1], spans: [{ start: "2026-01-01", end: "2026-08-20" }],
        badges: [{ kind: "left", date: "2026-08-20" }],
      },
    ],
    marks: {
      s1: { "2026-08-03": "present", "2026-08-04": "absent", "2026-08-08": "present" },
      s2: { "2026-08-03": "present" },
    },
    notes: {},
    units: { s1: { "2026-08-08": 1.5 } },
    slots: {},
    ghosts: {},
    dayAxis: {},
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

  it("🔑 반별 퇴원 확인 — 이름 칸 색 + 반 머리 요약 둘 다(원장 요청)", () => {
    const { container } = render1();
    const cell = nameCell(container, "이퇴원");
    expect(cell.getAttribute("data-name-tone")).toBe("withdrawn"); // 이름 칸 색(시간표와 같은 검정 바탕 흰 글씨)
    expect(cell.className).toContain("bg-[#414141]");
    expect(cell.className).toContain("text-white");
    expect(screen.getByText(/퇴원 1명 · 이퇴원/)).toBeTruthy(); // 반 머리 요약
    // 표시가 없는 학생은 색도 없다.
    expect(nameCell(container, "김학생").getAttribute("data-name-tone")).toBeNull();
  });

  /**
   * 🔑 원장 2026-10-07 *"급여 명세서에 신입 종강 라벨은 필요없고, 신입 퇴원만 셀 색상 변경해서 표시하는걸로. 기존 시간표처럼."*
   *    · *"이름의 셀 색상을 이용해 표시할것."*
   */
  it("🔑 급여명세서 별지는 이름 옆 라벨이 없다 — 신입은 빨강·퇴원은 검정 이름 칸, 전입·전출·종강은 표시 없음(원장 2026-10-07)", () => {
    const mixed = [
      {
        classId: "c5",
        className: "표시섞인반",
        matrix: matrix({
          students: [
            { id: "n1", name: "최신입", grade: "중1", school: "침산중", enrolledAt: null, attendDows: [1], spans: [{ start: "2026-08-10", end: null }], badges: [{ kind: "new", date: "2026-08-10" }] },
            { id: "l1", name: "이퇴원", grade: "중1", school: "침산중", enrolledAt: null, attendDows: [1], spans: [{ start: "2026-01-01", end: "2026-08-20" }], badges: [{ kind: "left", date: "2026-08-20" }] },
            { id: "i1", name: "정전입", grade: "중1", school: "침산중", enrolledAt: null, attendDows: [1], spans: [{ start: "2026-08-10", end: null, isTransferredIn: true }], badges: [{ kind: "transferIn", date: "2026-08-10", otherClassName: "중등M TP2B" }] },
            { id: "o1", name: "김전출", grade: "중1", school: "침산중", enrolledAt: null, attendDows: [1], spans: [{ start: "2026-01-01", end: "2026-08-20" }], badges: [{ kind: "transferOut", date: "2026-08-20", otherClassName: "중등M TP2B" }] },
            { id: "e1", name: "박종강", grade: "중1", school: "침산중", enrolledAt: null, attendDows: [1], spans: [{ start: "2026-08-03", end: "2026-08-20" }], badges: [{ kind: "classEnded", date: "2026-08-20", otherClassName: "중등M 초6 MS2A" }] },
            // 그 달에 들어왔다 나간 학생 — 퇴원이 이긴다(지금의 사실 · 반 머리 퇴원 명단과 같다).
            { id: "b1", name: "한잠깐", grade: "중1", school: "침산중", enrolledAt: null, attendDows: [1], spans: [{ start: "2026-08-03", end: "2026-08-20" }], badges: [{ kind: "new", date: "2026-08-03" }, { kind: "left", date: "2026-08-20" }] },
          ] as AttendanceMatrix["students"],
        }),
      },
    ];
    const { container } = render1({ groups: mixed });
    const tone = (name: string) => nameCell(container, name).getAttribute("data-name-tone");
    expect(tone("최신입")).toBe("new");
    expect(nameCell(container, "최신입").className).toContain("bg-danger");
    expect(tone("이퇴원")).toBe("withdrawn");
    expect(tone("한잠깐")).toBe("withdrawn");
    for (const name of ["정전입", "김전출", "박종강"]) {
      expect(tone(name)).toBeNull();
      expect(nameCell(container, name).className).not.toMatch(/bg-danger|bg-\[#414141\]/);
    }
    // 🔴 줄마다 라벨은 없다 — 이름 칸엔 이름만.
    for (const name of ["최신입", "이퇴원", "정전입", "김전출", "박종강", "한잠깐"]) expect(nameCell(container, name).textContent).toBe(name);
    for (const label of ["전입", "전출", "종강"]) expect(screen.queryByText(label)).toBeNull();
    // 색의 뜻은 머리에 한 번만(신입·퇴원 두 칩).
    expect([...container.querySelectorAll("[data-name-legend]")].map((e) => e.textContent)).toEqual(["신입", "퇴원"]);
    // 색칠된 퇴원 이름 = 반 머리 퇴원 명단(같은 재료).
    expect(screen.getByText(/퇴원 2명 · 이퇴원, 한잠깐/)).toBeTruthy();
  });

  /**
   * 🔑 판정은 화면(월별 출석부 이름 칸)과 같은 함수다 — 그 달 표식만 보면 **말일 퇴원**이 빠진다(그 달엔 "마지막 날까지 재원"이라
   *    표식이 없고 다음 달엔 명단에서 사라진다). 화면은 검정인데 종이만 무표시가 되던 구멍(적대 리뷰 2026-10-07).
   */
  it("🔑 말일 퇴원도 퇴원 색 + 반 머리 명단 — 그 달 표식이 없어도 학생 퇴원일로 판정한다(화면과 같은 함수)", () => {
    const lastDay = [
      {
        classId: "c6",
        className: "말일퇴원반",
        matrix: matrix({
          students: [
            { id: "w1", name: "오말일", grade: "고1", school: "경북고", enrolledAt: null, attendDows: [1], spans: [{ start: "2026-01-01", end: "2026-08-31" }], badges: [], withdrawnAt: "2026-08-31" },
            // 등록 31~60일은 색이 없다(신입 창을 지났다) — 화면의 연빨강을 명세서는 쓰지 않는다.
            { id: "r1", name: "유두달", grade: "고1", school: "경북고", enrolledAt: null, attendDows: [1], spans: [{ start: "2026-07-10", end: null }], badges: [] },
          ] as AttendanceMatrix["students"],
        }),
      },
    ];
    const { container } = render1({ groups: lastDay });
    expect(nameCell(container, "오말일").getAttribute("data-name-tone")).toBe("withdrawn");
    expect(screen.getByText(/퇴원 1명 · 오말일/)).toBeTruthy();
    expect(nameCell(container, "유두달").getAttribute("data-name-tone")).toBeNull();
    // 라벨을 쓰는 인쇄는 종전대로 그 달 표식만 본다(표식이 없으니 라벨도 머리 명단도 없다).
    const badge = render1({ groups: lastDay, nameStyle: "badge" });
    expect(nameCell(badge.container, "오말일").textContent).toBe("오말일");
  });

  it("반별·자리 출석부 인쇄(`nameStyle=\"badge\"`)는 종전대로 이름 옆 라벨 — 화면과 같은 표, 이름 칸 색은 안 쓴다", () => {
    const { container } = render1({ nameStyle: "badge", caption: "칸의 숫자 = 그날 인정된 수업 시수" });
    const cell = nameCell(container, "이퇴원");
    expect(cell.textContent).toBe("이퇴원퇴원");
    expect(cell.getAttribute("data-name-tone")).toBeNull();
    expect(container.querySelector("[data-name-legend]")).toBeNull();
    // 두 인쇄 화면이 실제로 그 값을 넘긴다(기본값이 급여명세서용이라 빠지면 라벨이 조용히 사라진다).
    for (const page of ["src/app/(print)/attendance/class/[classId]/month/print/page.tsx", "src/app/(print)/attendance/seat/[seat]/month/print/page.tsx"]) {
      expect(readFileSync(page, "utf8")).toContain('nameStyle="badge"');
    }
    // 급여명세서는 기본값(이름 칸 색)을 쓴다.
    expect(readFileSync("src/app/(print)/payroll/[teacherId]/payslip/page.tsx", "utf8")).not.toContain("nameStyle");
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
              attendDows: [1], spans: [{ start: "2026-01-01", end: null }], badges: [],
            },
          ] as AttendanceMatrix["students"],
        }),
      },
    ];
    render1({ groups: noLeave });
    expect(screen.queryByText(/퇴원 \d+명/)).toBeNull();
  });

  /**
   * 🔑 원장 2026-09-14 *"급여명세서도 '반이동'과 '퇴원'을 구분해서 퇴원처리해야지"*.
   * 종전엔 별지가 `others: []`로 표식을 **다시 계산**해 같은 날 이어받은 반이동을 전부 '퇴원'으로 찍었다
   * — 화면은 '반이동'인데 종이만 '퇴원'이라 갈렸다. 이제 매트릭스가 준 표식을 그대로 쓴다.
   */
  it("🔑 반이동은 '퇴원'이 아니다 — 이름 칸 색도, 반 머리 요약도(원장 2026-09-14)", () => {
    const moved = [
      {
        classId: "c3",
        className: "반이동반",
        matrix: matrix({
          students: [
            {
              id: "s3", name: "김이동", grade: "중2", school: "경명여중", enrolledAt: null,
              attendDows: [1], spans: [{ start: "2026-01-01", end: "2026-08-20" }],
              badges: [{ kind: "transferOut", date: "2026-08-20", otherClassName: "중등M TP2B" }],
            },
          ] as AttendanceMatrix["students"],
        }),
      },
    ];
    const { container } = render1({ groups: moved });
    // 다른 반으로 갔으니 퇴원 색이 아니다(전출 — 급여명세서에선 표시하지 않는다).
    expect(nameCell(container, "김이동").getAttribute("data-name-tone")).toBeNull();
    expect(container.querySelector('[data-name-tone="withdrawn"]')).toBeNull();
    expect(screen.queryByText(/퇴원 \d+명/)).toBeNull();
    // 라벨을 쓰는 인쇄(반별 출석부)에선 '전출'로 적힌다(원장 2026-09-18 — 반이동 표식을 전입/전출로 갈랐다).
    const badge = render1({ groups: moved, nameStyle: "badge" });
    expect(nameCell(badge.container, "김이동").textContent).toBe("김이동전출");
  });

  it("🔑 종강은 '퇴원'이 아니다 — 이름 칸 색이 없고, 반 머리 퇴원 명단엔 안 섞인다(원장 2026-09-14)", () => {
    const ended = [
      {
        classId: "c4",
        className: "[특강]중3-2 개념 완성반",
        matrix: matrix({
          students: [
            {
              id: "s4", name: "박종강", grade: "중3", school: "경명여중", enrolledAt: null,
              attendDows: [1], spans: [{ start: "2026-08-03", end: "2026-08-20" }],
              badges: [{ kind: "classEnded", date: "2026-08-20", otherClassName: "중등M 초6 MS2A" }],
            },
            {
              id: "s2", name: "이퇴원", grade: "중1", school: "침산중", enrolledAt: null,
              attendDows: [1], spans: [{ start: "2026-01-01", end: "2026-08-20" }],
              badges: [{ kind: "left", date: "2026-08-20" }],
            },
          ] as AttendanceMatrix["students"],
        }),
      },
    ];
    const { container } = render1({ groups: ended });
    expect(nameCell(container, "박종강").getAttribute("data-name-tone")).toBeNull();
    expect(screen.queryByText("종강")).toBeNull(); // 급여명세서엔 종강 라벨이 없다(원장 2026-10-07)
    expect(nameCell(container, "이퇴원").getAttribute("data-name-tone")).toBe("withdrawn");
    expect(screen.getByText(/퇴원 1명 · 이퇴원/)).toBeTruthy();
    expect(screen.queryByText(/박종강,|, 박종강/)).toBeNull();
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
