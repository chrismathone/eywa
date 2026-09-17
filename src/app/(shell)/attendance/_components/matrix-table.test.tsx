import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { tipRow, tipText } from "@/components/hover-tip/tip";
import { describe, expect, it, vi } from "vitest";
import type { AttendanceMatrix } from "@/features/attendance/server/queries";
import { ghostCellKind, ghostGridValue, rollupDay, type SlotMark } from "@/features/attendance/cell-display";
import { cellKey, rowKey } from "@/features/attendance/grid/model";
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
const S3 = "33333333-3333-3333-3333-333333333333";
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
    // 표식도 등원요일도 없는 학생 — 이름 한 줄만 서야 한다(아랫줄을 빈 채로 만들지 않는다).
    { id: S3, name: "한가온", grade: "중1", school: "대구중", enrolledAt: null, attendDows: [], spans: [], badges: [] },
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

describe("마우스 드래그 범위 선택", () => {
  function renderEditable() {
    const m = { ...GROUP.matrix, marks: { [S3]: { [DAYS[1]!.date]: "present" as const } } };
    const groups = [{ ...GROUP, matrix: m }];
    const ordered = m.students.map((s) => ({ classId: C, studentId: s.id }));
    const src = buildGridSource(groups, DAYS, ordered);
    return render(
      <GridProvider rows={src.rows} cols={src.cols} initial={src.initial} lockBefore={null}>
        <MatrixTable groups={groups} days={DAYS} holidays={{}} showGroups ordered={ordered} />
      </GridProvider>,
    );
  }

  it("드래그한 사각형에 복사한 1을 한 번에 붙여넣고, 놓은 뒤에는 선택이 유지된다", async () => {
    const actions = await import("@/features/attendance/server/actions");
    vi.mocked(actions.setAttendanceRange).mockClear();
    const { container } = renderEditable();
    const cells = screen.getAllByRole("gridcell");
    fireEvent.mouseDown(cells[5]!, { button: 0 });
    fireEvent.keyDown(cells[5]!, { key: "c", ctrlKey: true });
    fireEvent.pointerDown(cells[0]!, { pointerType: "mouse", pointerId: 1, button: 0 });
    fireEvent.mouseDown(cells[0]!, { button: 0 });
    const hit = vi.spyOn(document, "elementFromPoint").mockReturnValue(cells[3]!);
    try {
      fireEvent.pointerMove(document, { pointerType: "mouse", pointerId: 1, buttons: 1, clientX: 200, clientY: 160 });
      expect(screen.getAllByRole("gridcell", { selected: true })).toHaveLength(4);
      fireEvent.pointerUp(document, { pointerType: "mouse", pointerId: 1 });
      hit.mockReturnValue(cells[5]!);
      fireEvent.pointerMove(document, { pointerType: "mouse", pointerId: 1, buttons: 1 });
      expect(screen.getAllByRole("gridcell", { selected: true })).toHaveLength(4);
      fireEvent.keyDown(cells[0]!, { key: "v", ctrlKey: true });
      await waitFor(() => expect(actions.setAttendanceRange).toHaveBeenCalledTimes(1));
      expect(vi.mocked(actions.setAttendanceRange).mock.calls[0]![0]).toMatchObject({
        units: "1", status: "present",
        cells: [
          { classId: C, studentId: S1, sessionDate: DAYS[0]!.date },
          { classId: C, studentId: S1, sessionDate: DAYS[1]!.date },
          { classId: C, studentId: S2, sessionDate: DAYS[0]!.date },
          { classId: C, studentId: S2, sessionDate: DAYS[1]!.date },
        ],
      });
      expect(container.querySelector(".cursor-grab")).toBeNull();
    } finally { hit.mockRestore(); }
  });

  it("터치 드래그는 선택 영역을 만들지 않고 기본 스크롤에 맡긴다", () => {
    renderEditable();
    const cells = screen.getAllByRole("gridcell");
    fireEvent.mouseDown(cells[0]!, { button: 0 });
    const hit = vi.spyOn(document, "elementFromPoint").mockReturnValue(cells[3]!);
    try {
      fireEvent.pointerDown(cells[0]!, { pointerType: "touch", pointerId: 2, button: 0 });
      fireEvent.pointerMove(document, { pointerType: "touch", pointerId: 2, buttons: 1 });
      expect(screen.getAllByRole("gridcell", { selected: true })).toHaveLength(1);
    } finally { hit.mockRestore(); }
  });
});

describe("학교·학년 오른쪽 반별 청구액", () => {
  it.each([true, false])("반별 정렬=%s에서도 금액·0원·미확정을 구분한다", (showGroups) => {
    const { container } = render(
      <MatrixTable
        groups={[GROUP]} days={DAYS} holidays={{}} showGroups={showGroups}
        ordered={GROUP.matrix.students.map((s) => ({ classId: C, studentId: s.id }))}
        classBilledAmounts={{ [rowKey(C, S1)]: 210000, [rowKey(C, S2)]: 0 }}
      />,
    );
    expect(screen.getAllByRole("columnheader").slice(0, 3).map((h) => h.textContent)).toEqual([
      expect.stringContaining("이름"), "학교·학년", "청구액",
    ]);
    for (const [name, amount] of [["이도윤", "210,000"], ["박서준", "0"], ["한가온", "미확정"]]) {
      const row = screen.getByText(name!).closest("tr")!;
      expect(within(row).getAllByRole("cell")[2]).toHaveTextContent(amount!);
      expect(row.children).toHaveLength(DAYS.length + 5);
    }
    expect(container.querySelector("tfoot td")).toHaveAttribute("colspan", String(DAYS.length + 5));
    expect(screen.queryByRole("columnheader", { name: "납입" })).not.toBeInTheDocument();
  });
});

it("touch opens the attendance editor without changing a recorded status", () => {
  renderTable();
  const cell = screen.getAllByRole("gridcell")[0];
  fireEvent(cell, Object.assign(new MouseEvent("click", { bubbles: true, detail: 1 }), { pointerType: "touch" }));
  expect(screen.getByLabelText("메모(사유)")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /저장/ })).toBeInTheDocument();
});

/**
 * 칸의 툴팁은 **카드**다(원장 2026-09-15) — 옛 `title` 검사 자리를 그대로 잇는다.
 * `tipOf` = 카드를 한 줄로 편 글 · `statusOf` = 카드의 '상태' 줄(칸이 무슨 상태로 보이는가).
 */
const tipOf = (el: HTMLElement) => tipText(el.getAttribute("data-tip"));
const statusOf = (el: HTMLElement) => tipRow(el.getAttribute("data-tip"), "상태");

describe("격자 초기값 — 수업보고서 파생 칸", () => {
  it("🔴 파생 칸은 d 표식 — 상태가 보여도 출결 행이 없다(저장하면 새 행 = 수학 자동 시수)", () => {
    const m = matrix([
      { id: S1, name: "이도윤", grade: "고1", school: "경명여중", enrolledAt: null, attendDows: [3, 4], spans: [], badges: [] },
    ]);
    m.marks = { [S1]: { "2026-07-01": "present", "2026-07-02": "present" } } as never;
    m.derived = { [S1]: { "2026-07-01": true } };
    const src = buildGridSource([{ ...GROUP, matrix: m }], DAYS, [{ classId: C, studentId: S1 }]);
    expect(src.initial[cellKey(rowKey(C, S1), "2026-07-01")]).toEqual({ s: "present", u: null, d: true });
    // 수기 기록 칸엔 표식이 없다(행이 있다 — 저장은 갱신이라 자동값을 안 받는다).
    expect(src.initial[cellKey(rowKey(C, S1), "2026-07-02")]).toEqual({ s: "present", u: null });
  });
});

/**
 * 🔴 재리뷰 2026-09-11 — 팝오버 저장이 실패하면 **열 때의 값 그 객체**로 되칠해야 한다. 상태·시수로 새 객체를
 *    만들면 파생 표식 `d`가 빠져 서버 값({…, d: true})과 영영 같아지지 않고, 덮개가 남아 그 뒤 서버가
 *    바뀌어도 칸이 옛 값에 굳는다(격자 단건 저장은 원래 `prev` 그 객체로 되돌려서 멀쩡했다).
 */
describe("팝오버 저장 실패 — 파생 칸 되돌리기", () => {
  const DAY = "2026-07-01";
  function build(status: string, derived: boolean, note?: string, lockBefore: string | null = null) {
    const m = matrix([
      { id: S1, name: "이도윤", grade: "고1", school: "경명여중", enrolledAt: null, attendDows: [3], spans: [], badges: [] },
    ]);
    m.marks = { [S1]: { [DAY]: status } } as never;
    if (derived) m.derived = { [S1]: { [DAY]: true } };
    if (note) m.notes = { [S1]: { [DAY]: note } };
    const groups = [{ ...GROUP, matrix: m }];
    const ordered = [{ classId: C, studentId: S1 }];
    const src = buildGridSource(groups, DAYS, ordered);
    return (
      <GridProvider
        rows={src.rows}
        cols={src.cols}
        initial={src.initial}
        slotCounts={src.slotCounts}
        notMine={src.notMine}
        lockBefore={lockBefore}
      >
        {/* 잠금은 GridProvider와 MatrixTable **둘 다에** 넘긴다(page.tsx와 같은 배선 — matrix-lock.test.tsx 주석). */}
        <MatrixTable groups={groups} days={DAYS} holidays={{}} showGroups ordered={ordered} lockBefore={lockBefore} />
      </GridProvider>
    );
  }
  const cellAt = (c: HTMLElement) => c.querySelector<HTMLElement>(`[data-cell-key$="${DAY}"]`)!;

  it("🔴 실패하면 열 때의 값으로 돌아오고, 새로고침에서 덮개가 벗겨져 그 뒤 서버 값이 그대로 보인다", async () => {
    const actions = await import("@/features/attendance/server/actions");
    vi.mocked(actions.setAttendanceCell).mockResolvedValueOnce({ error: "잠시 후 다시 시도하세요" } as never);
    const { container, rerender } = render(build("present", true));
    fireEvent.contextMenu(cellAt(container));
    fireEvent.click(screen.getByRole("button", { name: "결석" }));
    await waitFor(() => expect(statusOf(cellAt(container))).toBe("출석")); // 실패 → 열 때의 값

    rerender(build("present", true)); // 새로고침 — 서버는 여전히 같은 파생 값
    rerender(build("absent", false)); // 그 뒤 서버가 결석으로 바뀜(다른 사람이 고침)
    await waitFor(() => expect(statusOf(cellAt(container))).toBe("결석"));
  });

  it("🔴 '지우기'가 실패해도 되돌린다 — 빈칸으로 굳으면 사용자는 지운 줄 안다", async () => {
    const actions = await import("@/features/attendance/server/actions");
    vi.mocked(actions.setAttendanceCell).mockResolvedValueOnce({ error: "잠시 후 다시 시도하세요" } as never);
    const { container, rerender } = render(build("present", false));
    fireEvent.contextMenu(cellAt(container));
    fireEvent.click(screen.getByRole("button", { name: "지우기" }));
    await waitFor(() => expect(statusOf(cellAt(container))).toBe("출석"));
    rerender(build("present", false)); // 새로고침해도 그대로
    expect(statusOf(cellAt(container))).toBe("출석");
  });

  it("🔴 응답 전에 같은 칸 팝오버를 다시 열었다 닫아도, 실패하면 칠하기 전 값으로 돌아온다", async () => {
    const actions = await import("@/features/attendance/server/actions");
    let settle: (v: unknown) => void = () => {};
    vi.mocked(actions.setAttendanceCell).mockImplementationOnce(
      () =>
        new Promise((r) => {
          settle = r;
        }) as never,
    );
    const { container } = render(build("present", false));
    fireEvent.contextMenu(cellAt(container));
    fireEvent.click(screen.getByRole("button", { name: "결석" }));
    expect(statusOf(cellAt(container))).toBe("결석"); // 낙관 반영
    fireEvent.contextMenu(cellAt(container)); // 메모를 적으려고 다시 열었다가
    fireEvent.click(document.querySelector<HTMLElement>("div.fixed.inset-0")!); // 저장 없이 닫음
    settle({ error: "잠시 후 다시 시도하세요" });
    await waitFor(() => expect(statusOf(cellAt(container))).toBe("출석"));
  });

  it("🔴 메모만 고친 저장이 실패하면 메모도 돌아온다 — 응답 전 새로고침이 값 덮개를 벗겨도", async () => {
    const actions = await import("@/features/attendance/server/actions");
    let settle: (v: unknown) => void = () => {};
    vi.mocked(actions.setAttendanceCell).mockImplementationOnce(
      () =>
        new Promise((r) => {
          settle = r;
        }) as never,
    );
    const { container, rerender } = render(build("present", false, "병결"));
    fireEvent.contextMenu(cellAt(container));
    fireEvent.change(screen.getByRole("textbox", { name: "메모(사유)" }), { target: { value: "가족여행" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(tipOf(cellAt(container))).toContain("가족여행"); // 낙관 반영
    rerender(build("present", false, "병결")); // 새로고침 — 값이 같아 덮개가 벗겨진다(서버 메모는 아직 옛 값)
    settle({ error: "잠시 후 다시 시도하세요" });
    await waitFor(() => expect(tipOf(cellAt(container))).toContain("병결"));
    expect(tipOf(cellAt(container))).not.toContain("가족여행");
  });

  it("🔴 메모를 안 보내는 상태 버튼이 앞 메모 저장의 실패를 삼키지 않는다 — 상태는 남고 메모만 돌아온다", async () => {
    const actions = await import("@/features/attendance/server/actions");
    let settleA: (v: unknown) => void = () => {};
    vi.mocked(actions.setAttendanceCell)
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            settleA = r;
          }) as never,
      )
      .mockResolvedValueOnce({ ok: true } as never);
    const { container } = render(build("present", false, "병결"));
    fireEvent.contextMenu(cellAt(container));
    fireEvent.change(screen.getByRole("textbox", { name: "메모(사유)" }), { target: { value: "가족여행" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" })); // A — 메모 저장(응답 대기)
    fireEvent.contextMenu(cellAt(container));
    fireEvent.click(screen.getByRole("button", { name: "지각" })); // B — 메모를 안 보내는 상태 버튼(성공)
    settleA({ error: "잠시 후 다시 시도하세요" });
    await waitFor(() => expect(tipOf(cellAt(container))).toContain("병결"));
    expect(statusOf(cellAt(container))).toBe("지각");
    expect(tipOf(cellAt(container))).not.toContain("가족여행");
  });

  it("🔴 서버가 내 메모를 따라잡으면 덮개를 벗긴다 — 격자로 지우고 다시 찍어도 옛 메모가 되살아나지 않는다", async () => {
    const actions = await import("@/features/attendance/server/actions");
    vi.mocked(actions.setAttendanceCell)
      .mockResolvedValueOnce({ ok: true } as never) // 메모 저장
      .mockResolvedValueOnce({ ok: true } as never) // 격자 Delete
      .mockResolvedValueOnce({ ok: true } as never); // 상태 버튼
    const title = (c: HTMLElement) => tipOf(cellAt(c));
    const { container, rerender } = render(build("present", false));
    fireEvent.contextMenu(cellAt(container));
    fireEvent.change(screen.getByRole("textbox", { name: "메모(사유)" }), { target: { value: "가족여행" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(title(container)).toContain("가족여행"));
    rerender(build("present", false, "가족여행")); // 저장 응답의 새로고침 — 서버가 메모를 따라잡았다
    fireEvent.mouseDown(cellAt(container), { button: 0 });
    fireEvent.keyDown(cellAt(container), { key: "Delete" }); // 격자 지우기 — 서버는 행과 메모를 함께 지운다
    await waitFor(() => expect(title(container)).not.toContain("가족여행"));
    fireEvent.contextMenu(cellAt(container));
    fireEvent.click(screen.getByRole("button", { name: "지각" })); // 빈 칸 → 메모 없는 새 행
    rerender(build("late", false)); // 새로고침 — 새 행엔 메모가 없다
    await waitFor(() => expect(statusOf(cellAt(container))).toBe("지각"));
    expect(title(container)).not.toContain("가족여행");
  });

  it("🔴 잠긴 칸의 '메모만 저장'은 끝난 쓰기다 — 같은 사유를 다시 저장한 뒤 다른 화면이 사유를 고치면 그 값을 따라간다", async () => {
    const actions = await import("@/features/attendance/server/actions");
    vi.mocked(actions.setAttendanceCell).mockResolvedValueOnce({ ok: true } as never);
    const title = (c: HTMLElement) => tipOf(cellAt(c));
    const { container, rerender } = render(build("absent", false, "병결", "2026-07-08")); // 7일 지나 잠긴 칸
    fireEvent.contextMenu(cellAt(container));
    fireEvent.click(screen.getByRole("button", { name: "메모 저장" })); // 같은 사유 그대로 — 잠긴 칸은 메모만
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull()); // 서버 확인 뒤 닫힘
    rerender(build("absent", false, "가족여행", "2026-07-08")); // 다른 화면이 사유를 고친 뒤 새로고침
    await waitFor(() => expect(title(container)).toContain("가족여행"));
    expect(title(container)).not.toContain("병결");
  });

  it("잠긴 칸의 '메모만 저장'은 값을 칠하지 않는다 — 새로고침 전에 서버 값이 바뀌면 그대로 따라간다", async () => {
    const actions = await import("@/features/attendance/server/actions");
    vi.mocked(actions.setAttendanceCell).mockResolvedValueOnce({ ok: true } as never);
    const aria = (c: HTMLElement) => cellAt(c).getAttribute("aria-label") ?? "";
    const { container, rerender } = render(build("absent", false, "병결", "2026-07-08"));
    fireEvent.contextMenu(cellAt(container));
    fireEvent.click(screen.getByRole("button", { name: "메모 저장" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    rerender(build("present", false, "병결", "2026-07-08")); // 그 사이 관리자가 '출석'으로 고쳤다
    await waitFor(() => expect(aria(container)).toContain("출석"));
    expect(aria(container)).not.toContain("결석");
  });
});

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
    expect(container.querySelector("th.sm\\:right-\\[64px\\]")).toBeTruthy(); // 넓은 화면에서 그 폭만큼 띄워 붙는다
  });

  it("등원요일은 이름 **아래 줄**에 온다 — 한 줄에 이으면 이름 열이 그만큼 넓어져야 한다", () => {
    renderTable();
    const nameCell = screen.getByText("이도윤").closest("td")!;
    const lines = [...nameCell.children];
    expect(lines).toHaveLength(2);
    expect(lines[0]!.textContent).toBe("이도윤"); // 이름 줄 — 표식은 아랫줄이라 이름만 선다(원장 2026-09-14)
    expect(lines[1]!.textContent).toBe("수·금"); // 등원요일
    // 고정 폭이라 넘치는 글자는 잘려야 한다(안 자르면 옆 칸을 덮는다).
    expect(screen.getByText("이도윤").className).toContain("truncate");
  });

  it("등원요일도 표식도 없으면 이름 한 줄만 — 빈 줄을 만들지 않는다", () => {
    renderTable();
    expect(screen.getByText("한가온").closest("td")!.children).toHaveLength(1);
  });

  it("🔴 표식만 있고 등원요일이 없어도 아랫줄에 선다 — 첫 줄은 언제나 이름뿐(원장 2026-09-14)", () => {
    renderTable();
    const cell = screen.getByText("박서준").closest("td")!;
    const lines = [...cell.children];
    expect(lines).toHaveLength(2);
    expect(lines[0]!.textContent).toBe("박서준");
    expect(lines[1]!.textContent).toBe("퇴원");
  });

  it("그 달에 나간 학생은 이름 칸에 '퇴원' 표식이 붙는다(아랫줄)", () => {
    renderTable();
    const badge = screen.getByText("퇴원");
    expect(badge.closest("td")).toBe(screen.getByText("박서준").closest("td"));
    expect(badge).toHaveAttribute("title", "2026-07-15 퇴원");
  });

  it("🔴 표식이 이름을 밀어내지 않는다 — 표식은 아랫줄이라 첫 줄은 이름이 열을 다 쓴다", () => {
    renderTable();
    // 뱃지가 첫 줄에 있던 동안 이름이 "김…"으로 잘렸다(원장 2026-09-14 "이름이 짤리는건 최악").
    expect(screen.getByText("퇴원").closest("span")!.className).toContain("shrink-0");
    expect(screen.getByText("박서준").parentElement!.textContent).toBe("박서준");
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
    expect(tipOf(cell)).toContain("2교시");
    expect(tipOf(cell)).toContain("12:30 출석 1 · 14:10 출석 1");
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
    expect(tipOf(cell)).toContain("14:10 결석 0");
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
    expect(tipOf(cell) ?? "").not.toContain("교시");
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
    expect(tipOf(cellOf(container))).toContain("이 화면 몫 아님");
  });

  it("🔴 자리(JJ)만 있는 날은 시수에 안 든다 — 예전엔 '값 없음'이 합계에서 1로 되살아났다", () => {
    const { container } = renderScoped([], [{ slot: "18:20:00", status: "present", units: null }]);
    expect(unitsOf(container)).toBe("—"); // 기록이 아예 없는 행과 같은 표기(0이 아니라 '없음')
  });

  it("🔴 그래도 빈칸이 아니다 — 빗금 + 툴팁으로 '기록은 있다'를 남긴다(#103)", () => {
    const { container } = renderScoped([], [{ slot: "18:20:00", status: "present", units: null }]);
    const cell = cellOf(container);
    expect(cell.style.backgroundImage).toContain("repeating-linear-gradient");
    expect(tipOf(cell)).toContain("18:20 출석 1");
    // 출석색으로 칠하지 않는다 — 내 출석이 아니다(범례의 0=결석과도 헷갈리지 않게 숫자를 안 쓴다).
    expect(cell.className).not.toContain("bg-att-present");
    expect(cell.textContent).not.toContain("0");
  });

  // ⚠️ 2026-09-14(원장 *"그 날의 해당 담당 출석으로 전부 이전"*)부터 막는 빗금 칸은 **자리뿐 · 담임 이전 기록 · 값이 파생뿐**이다 —
  //    다른 선생님 교시 기록만 있는 칸은 입력을 받아 상태만 옮긴다(아래 "빗금 칸 입력" 테스트들).
  it("🔴 자리(JJ)뿐인 빗금 칸은 입력을 안 받는다 — 사유도 자리로 말한다(반별 보기로 보내지 않는다)", () => {
    const { container } = renderScoped([], [seatGhost("18:20:00")]);
    const cell = cellOf(container);
    expect(cell.className).toContain("cursor-not-allowed");
    expect(tipOf(cell)).toContain("자리(JJ·랩실) 기록뿐");
    expect(tipOf(cell)).not.toContain("반별 보기에서 고치세요");
  });

  it("🔴 담임 이전 기록(pre)이 있는 빗금 칸은 종전대로 막는다 — 저장은 그 행을 제 몫으로 시수까지 쓴다", () => {
    const { container } = renderScoped([], [{ slot: "18:20:00", status: "present", units: null, pre: true }]);
    expect(cellOf(container).className).toContain("cursor-not-allowed");
    expect(tipOf(cellOf(container))).toContain("반별 보기에서 고치세요");
  });

  it("🔴 다른 선생님 교시 기록뿐인 빗금 칸은 막지 않는다 — 입력하면 상태만 옮긴다고 툴팁이 말한다", () => {
    const { container } = renderScoped([], [{ slot: "18:20:00", status: "present", units: null }]);
    expect(cellOf(container).className).not.toContain("cursor-not-allowed");
    expect(tipOf(cellOf(container))).toContain("상태만 옮깁니다");
  });

  it("🔴 빗금 칸의 **메모는 남는다** — 사라지는 게 결석 사유였다(실측 78칸)", () => {
    const { container } = renderScoped([], [{ slot: "18:20:00", status: "present", units: null }], "병결");
    const cell = cellOf(container);
    expect(tipOf(cell)).toContain("병결");
    // 접힌 모서리(메모 표식)도 남아야 호버하기 전에 "메모가 있다"를 안다.
    // ⚠️ `span[aria-hidden]`만으로는 선택·활성 덮개도 통과한다 — 모서리 스팬을 그 위치로 집는다.
    expect(cell.querySelector('span[aria-hidden][class*="top-0"][class*="right-0"]')).toBeTruthy();
  });

  /**
   * 🔴 격자(GridProvider) **안에서** 눌러야 진짜 검증이다 — 격자 없이 렌더하면 키보드 경로 자체가
   *    없어서 "액션이 안 불렸다"가 저절로 참이 된다(그렇게 짰다가 헛통과했다).
   */
  /** @param bothDays 이틀 다 같은 모양으로 — 범위(2칸) 조작을 재현할 때 쓴다. */
  /** @param withGhostValues 조회(queries)처럼 빗금 칸 입력 칸에 표시 값(`ghostValues`)을 싣는다. */
  function renderInGrid(owned: SlotMark[], others: SlotMark[], bothDays = false, withGhostValues = false) {
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
    // 조회와 같은 판정 — 제 몫 값이 없고 빗금 칸 입력(transfer)인 칸에만 표시 값(원장 2026-09-14).
    const gv = ghostGridValue(others);
    if (withGhostValues && !day && gv && ghostCellKind({ hasValue: false, derivedValue: false, others }) === "transfer") {
      m.ghostValues = { [S1]: Object.fromEntries(dates.map((d) => [d, gv])) };
    }
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
        lockBefore={null}
      >
        <MatrixTable groups={groups} days={DAYS} holidays={{}} showGroups ordered={ordered} />
      </GridProvider>,
    );
  }

  it("다른 교시 기록이 있어도 본인 칸은 지울 수 있다", async () => {
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
    expect(setAttendanceCell).toHaveBeenCalledWith(expect.objectContaining({ status: null }));
    expect(container.textContent).not.toContain("반별 보기에서 지우세요");
  });

  it("🔴 막는 빗금 칸(자리뿐)은 숫자를 쳐도 **버퍼가 안 열린다** — 열면 값이 보였다가 확정에서 거절돼 '쳤는데 사라졌다'가 된다", async () => {
    const { setAttendanceCell } = await import("@/features/attendance/server/actions");
    vi.mocked(setAttendanceCell).mockClear();
    const { container } = renderInGrid([], [seatGhost("18:20:00")]);
    const cell = cellOf(container);
    fireEvent.mouseDown(cell, { button: 0 });
    fireEvent.keyDown(cell, { key: "1" });
    expect(container.querySelector("input")).toBeNull();
    expect(setAttendanceCell).not.toHaveBeenCalled();
    expect(container.textContent).toContain("자리(JJ·랩실) 기록뿐");
  });

  it("본인 값을 수정할 때 다른 선생님 경고를 띄우지 않는다", async () => {
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
    expect(container.textContent).not.toContain("함께 바뀝니다");
  });

  it("여러 날짜의 본인 칸도 한 번에 지울 수 있다", async () => {
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
    expect(actions.setAttendanceRange).toHaveBeenCalledWith(expect.objectContaining({ status: null }));
    expect(actions.setAttendanceCell).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("다른 교시 기록이 함께 있어");
  });

  it("🔴 앵커가 빗금이어도 **범위 입력은 죽지 않는다** — 함께 잡은 정상 칸엔 들어가야 한다", async () => {
    const { setAttendanceCell } = await import("@/features/attendance/server/actions");
    vi.mocked(setAttendanceCell).mockClear();
    const { container } = renderInGrid([], [seatGhost("18:20:00")]);
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

  it("팝오버에서도 본인 칸 지우기를 제공한다", () => {
    const { container } = renderInGrid(
      [{ slot: "17:20:00", status: "present", units: null }],
      [{ slot: "18:20:00", status: "present", units: null }],
    );
    fireEvent.contextMenu(cellOf(container)); // 우클릭 = 상세 팝오버
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("button", { name: "지우기" })).toBeEnabled();
    expect(container.textContent).not.toContain("반별 보기에서 지우세요");
    // 저장은 열려 있으므로 **사정거리**도 격자와 같은 말로 알려야 한다(닫은 건 지우기 하나뿐).
    expect(container.textContent).not.toContain("함께 바뀝니다");
  });

  it("범위 지우기는 다른 교시가 있어도 선택한 본인 칸을 모두 보낸다", async () => {
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
    expect(vi.mocked(actions.setAttendanceRange).mock.calls[0]![0]!.cells).toHaveLength(4);
    await waitFor(() => expect(container.textContent).not.toContain("안 지웠습니다"));
  });

  it("세지 않는 교시가 없으면 종전 그대로(빗금 없음)", () => {
    const { container } = renderScoped([{ slot: "17:20:00", status: "present", units: null }], []);
    expect(cellOf(container).style.backgroundImage).toBe("");
  });

  /**
   * 🔴 원장 2026-09-12 *"jj는 개인강사 출석부에 넣음 안되지."* — 자리(JJ·랩실) 기록은 강사 보기 저장이 안 건드린다
   * (서버 규칙 = `splitOutSeatRows`). 그래서 화면도 "함께 바뀝니다"·지우기 막힘의 셈에서 자리를 **빼야** 한다 —
   * 안 빼면 화면이 "자리 기록도 함께 바뀐다"는 거짓말을 하고, 지울 수 있는 칸을 막는다.
   */
  const seatGhost = (slot: string): SlotMark => ({ slot, status: "present", units: null, seat: true });

  it("🔴 자리(JJ)만 섞인 칸은 단건 Delete가 열린다 — 서버가 자리 행을 남기고 제 몫만 지운다", async () => {
    const { setAttendanceCell } = await import("@/features/attendance/server/actions");
    vi.mocked(setAttendanceCell).mockClear();
    const { container } = renderInGrid([{ slot: "17:20:00", status: "present", units: null }], [seatGhost("16:20:00")]);
    const cell = cellOf(container);
    fireEvent.mouseDown(cell, { button: 0 });
    fireEvent.keyDown(cell, { key: "Delete" });
    expect(setAttendanceCell).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("반별 보기에서 지우세요");
  });

  it("🔴 자리만 섞인 칸의 툴팁 — '함께 바뀝니다'가 아니라 '그대로'라고 말한다", () => {
    const { container } = renderScoped([{ slot: "17:20:00", status: "present", units: null }], [seatGhost("16:20:00")]);
    const title = tipOf(cellOf(container));
    // 기록이 있다는 사실은 그대로 밝힌다(값에서만 뺀다).
    expect(title).toContain("이 화면 몫 아님");
    expect(title).toContain("자리(JJ·랩실) 기록은 이 칸을 고쳐도 그대로입니다");
    expect(title).not.toContain("함께 바뀝니다");
  });

  it("본인 기록을 지울 때 다른 교시 건수를 경고하지 않는다", () => {
    const { container } = renderInGrid(
      [{ slot: "17:20:00", status: "present", units: null }],
      [{ slot: "18:20:00", status: "present", units: null }, seatGhost("16:20:00")],
    );
    const cell = cellOf(container);
    fireEvent.mouseDown(cell, { button: 0 });
    fireEvent.keyDown(cell, { key: "Delete" });
    expect(container.textContent).not.toContain("다른 선생님 교시 기록 1건");
  });

  /**
   * 🔴 리뷰 2026-09-12: 값이 **수업보고서 파생**인데 그 날 실제 행은 자리(또는 남의 교시)뿐인 칸 — 파생은
   *    `manualDates`(내 몫 수기 마크)만 건너뛰므로 이런 칸을 '출석'으로 채운다. 그러면 `alsoWrites`는 0이라
   *    격자가 통과시키고 서버는 제 몫 행이 없어 `NOT_MINE_MESSAGE`로 거절한다 — **누르기 전에** 같은 사유로 막는다.
   */
  it("🔴 값이 파생뿐이고 실제 행은 자리뿐인 칸 — 빗금 칸과 같은 사유로 입력을 막는다", async () => {
    const { setAttendanceCell } = await import("@/features/attendance/server/actions");
    vi.mocked(setAttendanceCell).mockClear();
    const m = matrix([
      { id: S1, name: "김근호", grade: "중1", school: "경명여중", enrolledAt: null, attendDows: [3], spans: [], badges: [] },
    ]);
    m.marks = { [S1]: { [D1]: "present" } } as never; // 보고서에서 파생된 '출석'
    m.derived = { [S1]: { [D1]: true } };
    m.ghosts = { [S1]: { [D1]: [seatGhost("16:20:00")] } };
    const groups = [{ ...GROUP, matrix: m }];
    const ordered = [{ classId: C, studentId: S1 }];
    const src = buildGridSource(groups, DAYS, ordered);
    const { container } = render(
      <GridProvider
        rows={src.rows}
        cols={src.cols}
        initial={src.initial}
        slotCounts={src.slotCounts}
        notMine={src.notMine}
        lockBefore={null}
      >
        <MatrixTable groups={groups} days={DAYS} holidays={{}} showGroups ordered={ordered} />
      </GridProvider>,
    );
    const cell = container.querySelector<HTMLElement>(`[data-cell-key$="${D1}"]`)!;
    fireEvent.mouseDown(cell, { button: 0 });
    fireEvent.keyDown(cell, { key: "1" });
    expect(container.querySelector("input")).toBeNull(); // 버퍼가 안 열린다
    expect(setAttendanceCell).not.toHaveBeenCalled();
    // 실제 행이 자리뿐이라 사유도 자리로(2026-09-14 — 반별 보기로 보내면 자리 기록을 고치라는 거짓 안내).
    expect(container.textContent).toContain("자리(JJ·랩실) 기록뿐");
  });

  it("🔴 자리만 섞인 칸의 팝오버 — '지우기'가 열려 있고 사정거리 안내가 없다", () => {
    const { container } = renderInGrid([{ slot: "17:20:00", status: "present", units: null }], [seatGhost("16:20:00")]);
    fireEvent.contextMenu(cellOf(container));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.queryByText("지우기")).not.toBeNull();
    expect(container.textContent).not.toContain("반별 보기에서 지우세요");
  });

  /**
   * 🔴 원장 2026-09-14 *"그냥 그 날의 해당 담당 출석으로 전부 이전시켜. 다른 사람이 대신 찍었어도."* — 다른 선생님 교시
   *    기록만 있는 빗금 칸은 입력을 받아 그 교시에 **상태만** 옮긴다. 이 표 칸엔 빗금 위 흐린 값 · 합계 밖 · 지우기는 막는다.
   */
  const otherAbsent: SlotMark = { slot: "18:20:00", status: "absent", units: 1.5 };

  it("🔴 빗금 칸에 1 — 상태만 보낸다(시수 없음) · 빗금 위에 그 교시 시수가 흐리게 · 행 시수엔 안 든다", async () => {
    const { setAttendanceCell } = await import("@/features/attendance/server/actions");
    vi.mocked(setAttendanceCell).mockClear();
    vi.mocked(setAttendanceCell).mockResolvedValueOnce({ ok: true, ghostTransfer: 1 } as never);
    const { container } = renderInGrid([], [otherAbsent], false, true);
    expect(cellOf(container).textContent).toBe("0"); // 그 교시는 결석 = 0(흐리게)
    expect(unitsOf(container)).toBe("—");
    fireEvent.mouseDown(cellOf(container), { button: 0 });
    fireEvent.keyDown(cellOf(container), { key: "1" });
    fireEvent.keyDown(cellOf(container), { key: "Enter" });
    expect(setAttendanceCell).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(setAttendanceCell).mock.calls[0]![0];
    // 화면이 빗금 칸으로 알고 보낸다는 표식 — 서버 판정과 갈리면 서버가 저장하지 않는다(stale).
    expect(arg).toMatchObject({ status: "present", ghostTransfer: true });
    expect(arg).not.toHaveProperty("units");
    // 낙관값 = 그 교시 시수(1.5) — 서버가 시수를 안 바꾸니 새로고침 뒤 같은 숫자다.
    await waitFor(() => expect(cellOf(container).textContent).toBe("1.5"));
    expect(cellOf(container).style.backgroundImage).toContain("repeating-linear-gradient");
    expect(cellOf(container).querySelector("span.opacity-50")?.textContent).toBe("1.5");
    expect(unitsOf(container)).toBe("—"); // 이 표 합계엔 안 든다(담당 선생님 표와 이중 집계 금지)
    expect(container.textContent).toContain("상태만 옮겼습니다");
  });

  it("🔴 서버가 옮기지 않았다고 답하면(칸의 성격이 바뀜) 덮개를 벗긴다 — 칠한 값이 굳지 않게", async () => {
    const { setAttendanceCell } = await import("@/features/attendance/server/actions");
    vi.mocked(setAttendanceCell).mockClear();
    vi.mocked(setAttendanceCell).mockResolvedValueOnce({ ok: true } as never);
    const { container } = renderInGrid([], [otherAbsent], false, true);
    fireEvent.mouseDown(cellOf(container), { button: 0 });
    fireEvent.keyDown(cellOf(container), { key: "1" });
    fireEvent.keyDown(cellOf(container), { key: "Enter" });
    await waitFor(() => expect(setAttendanceCell).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(cellOf(container).textContent).toBe("0"));
  });

  it("🔴 빗금 칸 Delete는 막는다 — 남의 기록 삭제(기본값)", async () => {
    const { setAttendanceCell } = await import("@/features/attendance/server/actions");
    vi.mocked(setAttendanceCell).mockClear();
    const { container } = renderInGrid([], [otherAbsent], false, true);
    fireEvent.mouseDown(cellOf(container), { button: 0 });
    fireEvent.keyDown(cellOf(container), { key: "Delete" });
    expect(setAttendanceCell).not.toHaveBeenCalled();
    expect(container.textContent).toContain("여기서는 지울 수 없습니다");
  });

  it("🔴 범위 Delete도 빗금 칸을 빼고 사유를 말한다", async () => {
    const actions = await import("@/features/attendance/server/actions");
    vi.mocked(actions.setAttendanceCell).mockClear();
    vi.mocked(actions.setAttendanceRange).mockClear();
    const { container } = renderInGrid([], [otherAbsent], true, true);
    fireEvent.mouseDown(cellOf(container), { button: 0 });
    fireEvent.keyDown(cellOf(container), { key: "ArrowRight", shiftKey: true });
    fireEvent.keyDown(cellOf(container), { key: "Delete" });
    expect(actions.setAttendanceRange).not.toHaveBeenCalled();
    expect(actions.setAttendanceCell).not.toHaveBeenCalled();
    expect(container.textContent).toContain("다른 선생님 교시 기록뿐이라");
  });

  it("🔴 빗금 칸 우클릭 = 상태만 고르는 팝오버(시수·메모·지우기 없음) · 고르면 격자와 같은 문으로 저장", async () => {
    const { setAttendanceCell } = await import("@/features/attendance/server/actions");
    vi.mocked(setAttendanceCell).mockClear();
    vi.mocked(setAttendanceCell).mockResolvedValueOnce({ ok: true, ghostTransfer: 1 } as never);
    const { container } = renderInGrid([], [otherAbsent], false, true);
    fireEvent.contextMenu(cellOf(container));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.queryByLabelText("시수")).toBeNull();
    expect(screen.queryByLabelText("메모(사유)")).toBeNull();
    expect(screen.queryByText("지우기")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "지각" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(setAttendanceCell).toHaveBeenCalledTimes(1);
    expect(vi.mocked(setAttendanceCell).mock.calls[0]![0]).toMatchObject({ status: "late" });
    await waitFor(() => expect(cellOf(container).textContent).toBe("1.5"));
  });

  it("범위 채우기 — 서버가 옮긴 칸 수를 알리고, 그 칸은 빗금 위 흐린 값", async () => {
    const actions = await import("@/features/attendance/server/actions");
    vi.mocked(actions.setAttendanceRange).mockClear();
    vi.mocked(actions.setAttendanceRange).mockResolvedValueOnce({
      ok: true,
      applied: 2,
      blocked: 0,
      ghostCells: [
        { studentId: S1, classId: C, sessionDate: D1 },
        { studentId: S1, classId: C, sessionDate: "2026-07-02" },
      ],
    } as never);
    const { container } = renderInGrid([], [otherAbsent], true, true);
    fireEvent.mouseDown(cellOf(container), { button: 0 });
    fireEvent.keyDown(cellOf(container), { key: "ArrowRight", shiftKey: true });
    fireEvent.keyDown(cellOf(container), { key: "1" });
    fireEvent.keyDown(cellOf(container), { key: "Enter" });
    expect(actions.setAttendanceRange).toHaveBeenCalledTimes(1);
    expect(vi.mocked(actions.setAttendanceRange).mock.calls[0]![0]!.cells.every((c) => c.ghost === true)).toBe(true);
    await waitFor(() => expect(container.textContent).toContain("2칸은 다른 선생님 교시 기록에 상태만 옮겼습니다"));
    expect(cellOf(container).textContent).toBe("1.5");
    expect(unitsOf(container)).toBe("—");
  });

  /**
   * 🔴 적대 리뷰 2026-09-14 — 흐린 값이 보이는 빗금 칸을 복사·채우기 원본으로 쓰면 버퍼가 비어 붙여넣기가 '지우기'가 됐다
   *    (제 몫 기록이 지워진다). 원본으로 못 쓰게 막고 사유를 말한다 · 채우기 손잡이도 안 띄운다.
   */
  it("🔴 빗금 칸은 Ctrl+C·채우기 원본이 아니다 — 손잡이 없음 · 복사하면 사유를 말한다", async () => {
    const actions = await import("@/features/attendance/server/actions");
    vi.mocked(actions.setAttendanceCell).mockClear();
    vi.mocked(actions.setAttendanceRange).mockClear();
    const { container } = renderInGrid([], [otherAbsent], false, true);
    fireEvent.mouseDown(cellOf(container), { button: 0 });
    expect(cellOf(container).querySelector('[role="button"]')).toBeNull(); // 채우기 손잡이
    fireEvent.keyDown(cellOf(container), { key: "c", ctrlKey: true });
    expect(container.textContent).toContain("복사·채우기의 원본으로 쓸 수 없습니다");
    expect(actions.setAttendanceCell).not.toHaveBeenCalled();
    expect(actions.setAttendanceRange).not.toHaveBeenCalled();
  });

  it("🔴 빗금 칸 입력 뒤 Ctrl+Z는 앞의 엉뚱한 작업을 되돌리지 않는다 — 그 자리에서 사유를 말하고 멈춘다", async () => {
    const { setAttendanceCell } = await import("@/features/attendance/server/actions");
    vi.mocked(setAttendanceCell).mockClear();
    vi.mocked(setAttendanceCell)
      .mockResolvedValueOnce({ ok: true } as never)
      .mockResolvedValueOnce({ ok: true, ghostTransfer: 1 } as never);
    const { container } = renderInGrid([], [otherAbsent], false, true);
    const own = container.querySelector<HTMLElement>('[data-cell-key$="2026-07-02"]')!;
    fireEvent.mouseDown(own, { button: 0 });
    fireEvent.keyDown(own, { key: "1" });
    fireEvent.keyDown(own, { key: "Enter" }); // ① 제 몫 칸에 출석
    fireEvent.mouseDown(cellOf(container), { button: 0 });
    fireEvent.keyDown(cellOf(container), { key: "0" });
    fireEvent.keyDown(cellOf(container), { key: "Enter" }); // ② 빗금 칸에 결석(옮기기)
    await waitFor(() => expect(setAttendanceCell).toHaveBeenCalledTimes(2));
    fireEvent.keyDown(cellOf(container), { key: "z", ctrlKey: true });
    expect(setAttendanceCell).toHaveBeenCalledTimes(2); // ①을 되돌리는 저장이 나가지 않는다
    expect(container.textContent).toContain("되돌리기로 돌리지 않습니다");
    expect(own.textContent).toBe("1");
  });
});
