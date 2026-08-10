import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AttendanceMatrix } from "@/features/attendance/server/queries";
import { rollupDay, type SlotMark } from "@/features/attendance/cell-display";
import { MatrixTable, type MatrixGroup } from "./matrix-table";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/features/attendance/server/actions", () => ({
  setAttendanceCell: vi.fn(async () => ({ ok: true })),
  setAttendanceRange: vi.fn(async () => ({ ok: true, applied: 0, blocked: 0 })),
}));
vi.mock("@/features/attendance/server/prefs-actions", () => ({
  saveAttendanceCollapsed: vi.fn(async () => ({ ok: true })),
}));

const C = "aaaaaaaa-1111-1111-1111-111111111111";
const S1 = "11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const S2 = "22222222-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const DAYS: AttendanceMatrix["days"] = [
  { date: "2026-07-01", day: 1, dow: 3, label: "수", isWeekend: false, isToday: false },
  { date: "2026-07-02", day: 2, dow: 4, label: "목", isWeekend: false, isToday: false },
];

function matrix(students: AttendanceMatrix["students"]): AttendanceMatrix {
  return {
    classes: [],
    selectedClassId: C,
    month: "2026-07",
    window: { kind: "month", scope: null, start: "2026-07-01", end: "2026-07-31", label: "2026년 7월", defId: null },
    days: DAYS,
    classDows: [3],
    students,
    marks: {},
    notes: {},
    units: {},
    slots: {},
    derived: {},
    derivedActive: false,
    stats: {
      totalStudents: students.length,
      presentRate: 0,
      presentCount: 0,
      absentCount: 0,
      lateCount: 0,
      makeupCount: 0,
      totalRecords: 0,
    },
  };
}

const GROUP: MatrixGroup = {
  classId: C,
  className: "고등개별",
  subjectLabel: "수학",
  matrix: matrix([
    // spans 빈 배열 = 구간 모름 → 재원 외 음영을 안 칠한다(자료 없음을 회색으로 칠하지 않는다).
    { id: S1, name: "이도윤", grade: "고1", school: "경명여자중학교", enrolledAt: null, attendDows: [3, 5], spans: [], badges: [] },
    {
      id: S2,
      name: "박서준",
      grade: "중2",
      school: "대구중",
      enrolledAt: null,
      attendDows: [],
      spans: [],
      badges: [{ kind: "left" as const, date: "2026-07-15" }],
    },
  ]),
};

function renderTable() {
  return render(
    <MatrixTable
      groups={[GROUP]}
      days={DAYS}
      holidays={{}}
      showGroups
      ordered={[
        { classId: C, studentId: S1 },
        { classId: C, studentId: S2 },
      ]}
    />,
  );
}

describe("출석부 표 골격", () => {
  // 🔴 열 폭이 내용에서 나오면 반을 접을 때마다(긴 학교 이름이 사라질 때마다) 표가 출렁인다.
  //    폭의 단일 소스는 colgroup이고, 표는 table-fixed여야 그 값이 실제로 쓰인다.
  it("🔴 열 폭은 colgroup이 정한다 — 내용이 아니라(table-fixed)", () => {
    const { container } = renderTable();
    const table = container.querySelector("table")!;
    expect(table.className).toContain("table-fixed");
    const cols = container.querySelectorAll("colgroup col");
    // 이름·학년·학교 + 날짜 2 + 시수·출석률
    expect(cols.length).toBe(3 + DAYS.length + 2);
    expect((cols[0] as HTMLElement).style.width).toBeTruthy(); // 이름
    expect((cols[1] as HTMLElement).style.width).toBeTruthy(); // 학년
    expect((cols[2] as HTMLElement).style.width).toBeTruthy(); // 학교
    // 날짜 칸만 폭이 비어 있다 — 남는 가로 폭을 이 칸들이 나눠 갖는다.
    expect((cols[3] as HTMLElement).style.width).toBe("");
  });

  it("🔴 마지막 두 열(시수·출석률)은 sticky right 오프셋과 짝이라 폭이 고정이다", () => {
    const { container } = renderTable();
    const cols = container.querySelectorAll("colgroup col");
    expect((cols[cols.length - 1] as HTMLElement).style.width).toBe("64px"); // 출석률
    expect(container.querySelector("th.right-\\[64px\\]")).toBeTruthy(); // 시수 헤더가 그 폭만큼 띄워 붙는다
  });

  it("등원요일은 이름 **아래 줄**에 온다 — 한 줄에 이으면 이름 열이 그만큼 넓어져야 한다", () => {
    renderTable();
    const nameCell = screen.getByText("이도윤").closest("td")!;
    const lines = [...nameCell.children];
    expect(lines).toHaveLength(2);
    expect(lines[0]!.textContent).toBe("이도윤"); // 이름 줄(+표식이 있으면 같은 줄)
    expect(lines[1]!.textContent).toBe("수·금"); // 등원요일
    // 고정 폭이라 넘치는 글자는 잘려야 한다(안 자르면 옆 칸을 덮는다).
    expect(screen.getByText("이도윤").className).toContain("truncate");
  });

  it("등원요일이 없으면 이름 한 줄만 — 빈 줄을 만들지 않는다", () => {
    renderTable();
    expect(screen.getByText("박서준").closest("td")!.children).toHaveLength(1);
  });

  it("그 달에 나간 학생은 이름 옆에 '퇴원' 표식이 붙는다", () => {
    renderTable();
    const badge = screen.getByText("퇴원");
    expect(badge.closest("td")).toBe(screen.getByText("박서준").closest("td"));
    expect(badge).toHaveAttribute("title", "2026-07-15 퇴원");
  });

  it("🔴 표식이 이름을 밀어내지 않는다 — 열 폭이 고정이라 이름이 먼저 잘린다", () => {
    renderTable();
    expect(screen.getByText("퇴원").className).toContain("shrink-0");
    expect(screen.getByText("박서준").className).toContain("min-w-0");
  });

  it("표식이 없는 학생에겐 아무것도 안 붙는다 — 대부분의 행", () => {
    renderTable();
    const nameLine = screen.getByText("이도윤").parentElement!;
    expect(nameLine.textContent).toBe("이도윤");
  });

  it("학교 이름은 잘리되 원문은 툴팁에 남는다 — 화면에서 사라지면 안 된다", () => {
    renderTable();
    const school = screen.getByText("경명여자중학교");
    expect(school.className).toContain("truncate");
    expect(school).toHaveAttribute("title", "경명여자중학교");
  });

  it("상세 입력은 우클릭으로 연다고 안내한다", () => {
    const { container } = renderTable();
    expect(container.textContent).toContain("지각·조퇴·보강·메모는 우클릭");
  });
});

/**
 * 하루 2교시(0196a) — 출석부는 학생×날짜 격자라 칸이 하나뿐이다.
 * 🔴 예전엔 그날 최신 1건만 살아남아 **다른 교시가 화면에서 통째로 사라졌다**(기록·급여엔 있는데).
 */
describe("교시 롤업 칸", () => {
  const D1 = "2026-07-01";
  function renderWithSlots(slots: SlotMark[]) {
    const m = matrix([
      { id: S1, name: "이도윤", grade: "고1", school: "경명여중", enrolledAt: null, attendDows: [3], spans: [], badges: [] },
    ]);
    const day = rollupDay(slots)!;
    m.marks = { [S1]: { [D1]: day.status as never } };
    if (day.units !== 1) m.units = { [S1]: { [D1]: day.units } };
    m.slots = { [S1]: { [D1]: day.slots } };
    return render(
      <MatrixTable
        groups={[{ ...GROUP, matrix: m }]}
        days={DAYS}
        holidays={{}}
        showGroups
        ordered={[{ classId: C, studentId: S1 }]}
      />,
    );
  }
  const cellOf = (c: HTMLElement) => c.querySelector<HTMLElement>(`[data-cell-key$="${D1}"]`)!;

  it("🔴 2교시 출석은 '2' — 한 건만 세면 급여(회차 소비)보다 적게 말한다", () => {
    const { container } = renderWithSlots([
      { slot: "12:30:00", status: "present", units: null },
      { slot: "14:10:00", status: "present", units: null },
    ]);
    const cell = cellOf(container);
    expect(cell.textContent).toContain("2");
    expect(cell.className).toContain("bg-att-present");
    expect(cell.getAttribute("title")).toContain("2교시");
    expect(cell.getAttribute("title")).toContain("12:30 출석 1 · 14:10 출석 1");
  });

  it("🔴 출석+결석이 섞인 날은 줄무늬 — 빠진 교시가 칸에서 사라지지 않는다", () => {
    const { container } = renderWithSlots([
      { slot: "12:30:00", status: "present", units: null },
      { slot: "14:10:00", status: "absent", units: null },
    ]);
    const cell = cellOf(container);
    expect(cell.textContent).toContain("1"); // 들은 1시수만
    expect(cell.style.background).toContain("var(--att-present)");
    expect(cell.style.background).toContain("var(--att-absent)");
    expect(cell.getAttribute("title")).toContain("14:10 결석 0");
  });

  it("행 시수 합은 칸 숫자와 같다 — 화면 두 곳이 다른 말을 하면 안 된다", () => {
    const { container } = renderWithSlots([
      { slot: "12:30:00", status: "present", units: null },
      { slot: "14:10:00", status: "present", units: null },
    ]);
    // 마지막 두 열 = 시수·출석률. 시수 칸이 2를 말해야 한다.
    const totals = [...container.querySelectorAll("tbody tr td")].slice(-2);
    expect(totals[0]!.textContent).toContain("2");
  });

  it("교시가 하나면 종전과 같다 — 줄무늬도 '교시' 툴팁도 없다", () => {
    const { container } = renderWithSlots([{ slot: null, status: "present", units: null }]);
    const cell = cellOf(container);
    expect(cell.textContent).toContain("1");
    expect(cell.style.background).toBe("");
    expect(cell.getAttribute("title") ?? "").not.toContain("교시");
  });
});
