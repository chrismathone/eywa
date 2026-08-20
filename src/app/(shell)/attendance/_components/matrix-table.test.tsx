import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AttendanceMatrix } from "@/features/attendance/server/queries";
import { rollupDay, type SlotMark } from "@/features/attendance/cell-display";
import { MatrixTable, buildGridSource, type MatrixGroup } from "./matrix-table";
import { GridProvider } from "./grid-context";

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
    ghosts: {},
    dayAxis: {},
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
    // 이름·학교·학년(압축 한 열, 2026-08-10) + 날짜 2 + 시수·출석률
    expect(cols.length).toBe(2 + DAYS.length + 2);
    expect((cols[0] as HTMLElement).style.width).toBeTruthy(); // 이름
    expect((cols[1] as HTMLElement).style.width).toBeTruthy(); // 학교·학년
    // 날짜 칸만 폭이 비어 있다 — 남는 가로 폭을 이 칸들이 나눠 갖는다.
    expect((cols[2] as HTMLElement).style.width).toBe("");
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

  it("학교·학년은 압축 한 열('경명여자중학교1') — 잘리되 원문은 툴팁에 남는다", () => {
    renderTable();
    // schoolGradeLabel: "경명여자중학교"+"고1" → "경명여자중학교1" (표시 표준, school-grade.ts)
    const school = screen.getByText("경명여자중학교1");
    expect(school.className).toContain("truncate");
    expect(school).toHaveAttribute("title", "경명여자중학교 · 고1");
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

/**
 * 강사 전체 보기 = **그 강사 교시만** 센다(queries `scopeTeacherId`).
 * 🔴 원장 제보 2026-08-10: 8/10 김근호가 이다교 선생님 출석부에 **3**(16:20 정유진·17:20 이다교·18:20 JJ).
 *    이다교 몫은 1이다. 여기서 잠그는 건 "칸 숫자 = 행 시수 = 세지 않는 교시 제외"가 **한 숫자**라는 것.
 */
describe("세지 않는 교시(자리·남의 교시)", () => {
  const D1 = "2026-07-01";
  function renderScoped(owned: SlotMark[], others: SlotMark[], note?: string) {
    const m = matrix([
      { id: S1, name: "김근호", grade: "중1", school: "경명여중", enrolledAt: null, attendDows: [3], spans: [], badges: [] },
    ]);
    const day = owned.length > 0 ? rollupDay(owned) : null;
    if (day) {
      m.marks = { [S1]: { [D1]: day.status as never } };
      if (day.units !== 1 && day.units > 0) m.units = { [S1]: { [D1]: day.units } };
      if (day.count > 1) m.slots = { [S1]: { [D1]: day.slots } };
    }
    m.ghosts = { [S1]: { [D1]: others } };
    if (note) m.notes = { [S1]: { [D1]: note } };
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
  const unitsOf = (c: HTMLElement) => [...c.querySelectorAll("tbody tr td")].slice(-2)[0]!.textContent;

  it("🔴 내 교시 1 + 남의 교시 2 = 칸도 행 시수도 **1**(3이 아니다)", () => {
    const { container } = renderScoped(
      [{ slot: "17:20:00", status: "present", units: null }],
      [
        { slot: "16:20:00", status: "present", units: null },
        { slot: "18:20:00", status: "present", units: null },
      ],
    );
    expect(cellOf(container).textContent).toContain("1");
    expect(unitsOf(container)).toContain("1");
    expect(cellOf(container).getAttribute("title")).toContain("이 선생님 몫으로 세지 않는 기록");
  });

  it("🔴 자리(JJ)만 있는 날은 시수에 안 든다 — 예전엔 '값 없음'이 합계에서 1로 되살아났다", () => {
    const { container } = renderScoped([], [{ slot: "18:20:00", status: "present", units: null }]);
    expect(unitsOf(container)).toBe("—"); // 기록이 아예 없는 행과 같은 표기(0이 아니라 '없음')
  });

  it("🔴 그래도 빈칸이 아니다 — 빗금 + 툴팁으로 '기록은 있다'를 남긴다(#103)", () => {
    const { container } = renderScoped([], [{ slot: "18:20:00", status: "present", units: null }]);
    const cell = cellOf(container);
    expect(cell.style.backgroundImage).toContain("repeating-linear-gradient");
    expect(cell.getAttribute("title")).toContain("18:20 출석 1");
    // 출석색으로 칠하지 않는다 — 내 출석이 아니다(범례의 0=결석과도 헷갈리지 않게 숫자를 안 쓴다).
    expect(cell.className).not.toContain("bg-att-present");
    expect(cell.textContent).not.toContain("0");
  });

  it("🔴 빗금 칸은 **입력을 안 받는다** — 저장은 그날 모든 교시에 가는데 화면엔 흔적이 안 남는다", () => {
    const { container } = renderScoped([], [{ slot: "18:20:00", status: "present", units: null }]);
    const cell = cellOf(container);
    expect(cell.className).toContain("cursor-not-allowed");
    expect(cell.getAttribute("title")).toContain("반별 보기에서 고치세요");
  });

  it("🔴 빗금 칸의 **메모는 남는다** — 사라지는 게 결석 사유였다(실측 78칸)", () => {
    const { container } = renderScoped([], [{ slot: "18:20:00", status: "present", units: null }], "병결");
    const cell = cellOf(container);
    expect(cell.getAttribute("title")).toContain("병결");
    // 접힌 모서리(메모 표식)도 남아야 호버하기 전에 "메모가 있다"를 안다.
    // ⚠️ `span[aria-hidden]`만으로는 선택·활성 덮개도 통과한다 — 모서리 스팬을 그 위치로 집는다.
    expect(cell.querySelector('span[aria-hidden][class*="top-0"][class*="right-0"]')).toBeTruthy();
  });

  /**
   * 🔴 격자(GridProvider) **안에서** 눌러야 진짜 검증이다 — 격자 없이 렌더하면 키보드 경로 자체가
   *    없어서 "액션이 안 불렸다"가 저절로 참이 된다(그렇게 짰다가 헛통과했다).
   */
  /** @param bothDays 이틀 다 같은 모양으로 — 범위(2칸) 조작을 재현할 때 쓴다. */
  function renderInGrid(owned: SlotMark[], others: SlotMark[], bothDays = false) {
    const m = matrix([
      { id: S1, name: "김근호", grade: "중1", school: "경명여중", enrolledAt: null, attendDows: [3], spans: [], badges: [] },
    ]);
    const dates = bothDays ? [D1, "2026-07-02"] : [D1];
    const day = owned.length > 0 ? rollupDay(owned) : null;
    if (day) {
      m.marks = { [S1]: Object.fromEntries(dates.map((d) => [d, day.status])) as never };
      if (day.units !== 1 && day.units > 0) m.units = { [S1]: Object.fromEntries(dates.map((d) => [d, day.units])) };
      if (day.count > 1) m.slots = { [S1]: Object.fromEntries(dates.map((d) => [d, day.slots])) };
    }
    m.ghosts = { [S1]: Object.fromEntries(dates.map((d) => [d, others])) };
    const groups = [{ ...GROUP, matrix: m }];
    const ordered = [{ classId: C, studentId: S1 }];
    const src = buildGridSource(groups, DAYS, ordered);
    return render(
      <GridProvider
        rows={src.rows}
        cols={src.cols}
        initial={src.initial}
        slotCounts={src.slotCounts}
        notMine={src.notMine}
        alsoWrites={src.alsoWrites}
        lockBefore={null}
      >
        <MatrixTable groups={groups} days={DAYS} holidays={{}} showGroups ordered={ordered} />
      </GridProvider>,
    );
  }

  it("🔴 섞인 칸의 **단건 Delete는 막는다** — 지우면 남의 교시·JJ 기록까지 함께 사라진다", async () => {
    const { setAttendanceCell } = await import("@/features/attendance/server/actions");
    vi.mocked(setAttendanceCell).mockClear();
    const { container } = renderInGrid(
      [{ slot: "17:20:00", status: "present", units: null }],
      [
        { slot: "16:20:00", status: "present", units: null },
        { slot: "18:20:00", status: "present", units: null },
      ],
    );
    const cell = cellOf(container);
    fireEvent.mouseDown(cell, { button: 0 });
    fireEvent.keyDown(cell, { key: "Delete" });
    // 저장(삭제) 액션이 아예 안 나가야 한다 — 나가면 그날 행이 통째로 지워진다(저장에 교시 축이 없다).
    expect(setAttendanceCell).not.toHaveBeenCalled();
    expect(container.textContent).toContain("반별 보기에서 지우세요");
  });

  it("🔴 빗금 칸은 숫자를 쳐도 **버퍼가 안 열린다** — 열면 값이 보였다가 확정에서 거절돼 '쳤는데 사라졌다'가 된다", async () => {
    const { setAttendanceCell } = await import("@/features/attendance/server/actions");
    vi.mocked(setAttendanceCell).mockClear();
    const { container } = renderInGrid([], [{ slot: "18:20:00", status: "present", units: null }]);
    const cell = cellOf(container);
    fireEvent.mouseDown(cell, { button: 0 });
    fireEvent.keyDown(cell, { key: "1" });
    expect(container.querySelector("input")).toBeNull();
    expect(setAttendanceCell).not.toHaveBeenCalled();
    expect(container.textContent).toContain("이 화면의 몫이 아니라");
  });

  it("섞인 칸에 값을 쓰는 건 막지 않는다 — 대신 사정거리를 알린다", async () => {
    const { setAttendanceCell } = await import("@/features/attendance/server/actions");
    vi.mocked(setAttendanceCell).mockClear();
    const { container } = renderInGrid(
      [{ slot: "17:20:00", status: "present", units: null }],
      [{ slot: "18:20:00", status: "present", units: null }],
    );
    const cell = cellOf(container);
    fireEvent.mouseDown(cell, { button: 0 });
    fireEvent.keyDown(cell, { key: "0" }); // 결석
    fireEvent.keyDown(cell, { key: "Enter" });
    expect(setAttendanceCell).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("함께 바뀝니다");
  });

  it("🔴 **범위 Delete도** 섞인 칸을 지우지 않는다 — 1칸은 거절, 2칸은 실행이면 모순이다", async () => {
    const actions = await import("@/features/attendance/server/actions");
    vi.mocked(actions.setAttendanceCell).mockClear();
    vi.mocked(actions.setAttendanceRange).mockClear();
    const { container } = renderInGrid(
      [{ slot: "17:20:00", status: "present", units: null }],
      [{ slot: "18:20:00", status: "present", units: null }],
      true, // 이틀 다 섞인 칸
    );
    const cell = cellOf(container);
    fireEvent.mouseDown(cell, { button: 0 });
    fireEvent.keyDown(cell, { key: "ArrowRight", shiftKey: true });
    fireEvent.keyDown(cell, { key: "Delete" });
    expect(actions.setAttendanceRange).not.toHaveBeenCalled();
    expect(actions.setAttendanceCell).not.toHaveBeenCalled();
    expect(container.textContent).toContain("다른 교시 기록이 함께 있어");
  });

  it("🔴 앵커가 빗금이어도 **범위 입력은 죽지 않는다** — 함께 잡은 정상 칸엔 들어가야 한다", async () => {
    const { setAttendanceCell } = await import("@/features/attendance/server/actions");
    vi.mocked(setAttendanceCell).mockClear();
    const { container } = renderInGrid([], [{ slot: "18:20:00", status: "present", units: null }]);
    const cell = cellOf(container);
    fireEvent.mouseDown(cell, { button: 0 });
    // 한 행을 왼쪽부터 끄는 흔한 조작 — 앵커(7/1)는 빗금, 옆 칸(7/2)은 내 칸이다.
    fireEvent.keyDown(cell, { key: "ArrowRight", shiftKey: true });
    fireEvent.keyDown(cell, { key: "1" });
    expect(container.querySelector("input")).not.toBeNull(); // 버퍼가 열린다(종전엔 통째로 막혔다)
    fireEvent.keyDown(cell, { key: "Enter" });
    // 빗금 칸만 빠지고 나머지 한 칸엔 실제로 저장된다 + 건너뛴 사실을 알린다.
    expect(setAttendanceCell).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("건너뛰었습니다");
  });

  it("🔴 팝오버 '지우기'도 **같은 게이트**를 지난다 — 격자만 막으면 여기로 새어 나간다(#77)", () => {
    const { container } = renderInGrid(
      [{ slot: "17:20:00", status: "present", units: null }],
      [{ slot: "18:20:00", status: "present", units: null }],
    );
    fireEvent.contextMenu(cellOf(container)); // 우클릭 = 상세 팝오버
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.queryByText("지우기")).toBeNull();
    expect(container.textContent).toContain("반별 보기에서 지우세요");
    // 저장은 열려 있으므로 **사정거리**도 격자와 같은 말로 알려야 한다(닫은 건 지우기 하나뿐).
    expect(container.textContent).toContain("함께 바뀝니다");
  });

  it("🔴 범위 Delete가 섞인 칸을 뺐으면 **말해 준다** — 조용히 빠지면 다 지운 줄 안다", async () => {
    const actions = await import("@/features/attendance/server/actions");
    vi.mocked(actions.setAttendanceRange).mockClear();
    const D2 = "2026-07-02";
    const m = matrix([
      { id: S1, name: "김근호", grade: "중1", school: "경명여중", enrolledAt: null, attendDows: [3], spans: [], badges: [] },
      { id: S2, name: "박서준", grade: "중2", school: "대구중", enrolledAt: null, attendDows: [3], spans: [], badges: [] },
    ]);
    // 네 칸 모두 값이 있고, S1의 7/1만 남의 교시가 함께 있다(= 지우면 그것까지 지워지는 칸).
    m.marks = {
      [S1]: { [D1]: "present", [D2]: "present" },
      [S2]: { [D1]: "present", [D2]: "present" },
    } as never;
    m.ghosts = { [S1]: { [D1]: [{ slot: "18:20:00", status: "present", units: null }] } };
    const groups = [{ ...GROUP, matrix: m }];
    const ordered = [
      { classId: C, studentId: S1 },
      { classId: C, studentId: S2 },
    ];
    const src = buildGridSource(groups, DAYS, ordered);
    const { container } = render(
      <GridProvider
        rows={src.rows}
        cols={src.cols}
        initial={src.initial}
        slotCounts={src.slotCounts}
        notMine={src.notMine}
        alsoWrites={src.alsoWrites}
        lockBefore={null}
      >
        <MatrixTable groups={groups} days={DAYS} holidays={{}} showGroups ordered={ordered} />
      </GridProvider>,
    );
    const first = container.querySelectorAll<HTMLElement>(`[data-cell-key$="${D1}"]`)[0]!;
    fireEvent.mouseDown(first, { button: 0 });
    fireEvent.keyDown(first, { key: "ArrowRight", shiftKey: true });
    fireEvent.keyDown(first, { key: "ArrowDown", shiftKey: true });
    fireEvent.keyDown(first, { key: "Delete" });
    // 섞인 칸 1개는 빠지고 나머지 3칸만 지운다 — 그리고 그 사실을 알린다.
    expect(vi.mocked(actions.setAttendanceRange).mock.calls[0]![0]!.cells).toHaveLength(3);
    await waitFor(() => expect(container.textContent).toContain("안 지웠습니다"));
  });

  it("세지 않는 교시가 없으면 종전 그대로(빗금 없음)", () => {
    const { container } = renderScoped([{ slot: "17:20:00", status: "present", units: null }], []);
    expect(cellOf(container).style.backgroundImage).toBe("");
  });
});
