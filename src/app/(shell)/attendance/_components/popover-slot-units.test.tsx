/**
 * 팝오버 '출석'도 격자 타이핑과 **같은 함수**(`ctx.toValue` = optimisticGridValue + 그날 교시 수)로 칠한다
 * (리뷰 2026-09-11 — 원장 제보 *"새로고침하면 강제로 어떤 숫자로 롤백"*과 같은 증상).
 *
 * 강사 전체 보기에서 **내 교시가 둘**인 칸(전부 결석)에 팝오버 '출석'(시수 비움)을 누르면 서버는 내 교시 두 행을
 * 기본(1)씩 = 합 2로 저장한다. 종전엔 팝오버가 1로 칠해서 덮개가 서버(2)와 영영 같아지지 않았고(store.setSource는
 * 같아질 때만 벗긴다), 강력 새로고침 전까지 칸이 1에 굳었다.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { tipRow } from "@/components/hover-tip/tip";
import { describe, expect, it, vi } from "vitest";
import type { AttendanceMatrix } from "@/features/attendance/server/queries";
import type { SlotMark } from "@/features/attendance/cell-display";
import { MatrixTable, buildGridSource, type MatrixGroup } from "./matrix-table";
import { GridProvider } from "./grid-context";
import { AttendanceScopeProvider } from "./scope-context";

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
const T = "55555555-5555-5555-5555-555555555555";
const DAY = "2026-07-01";
const DAYS: AttendanceMatrix["days"] = [
  { date: DAY, day: 1, dow: 3, label: "수", isWeekend: false, isToday: false },
  { date: "2026-07-02", day: 2, dow: 4, label: "목", isWeekend: false, isToday: false },
];

/**
 * 서버가 그린 강사 보기 한 칸 — 내 교시 둘(17:20·18:20) + 남의 교시(자리 JJ 16:20, 값이 아니라 표시만).
 * @param units 그날 내 교시 **합**(서버 규약: 1이면 키 없음 = null).
 */
function build(
  status: SlotMark["status"],
  units: number | null,
  slotUnits: [number | null, number | null] = [null, null],
) {
  const mine: SlotMark[] = [
    { slot: "17:20", status, units: slotUnits[0] },
    { slot: "18:20", status, units: slotUnits[1] },
  ];
  const matrix: AttendanceMatrix = {
    classes: [],
    selectedClassId: C,
    month: "2026-07",
    window: { kind: "month", scope: null, start: "2026-07-01", end: "2026-07-31", label: "2026년 7월", defId: null },
    days: DAYS,
    classDows: [3],
    students: [
      { id: S1, name: "이도윤", grade: "중2", school: "경명여중", enrolledAt: null, attendDows: [3], spans: [], badges: [] },
    ],
    marks: { [S1]: { [DAY]: status } } as never,
    notes: {},
    units: units === null ? {} : { [S1]: { [DAY]: units } },
    slots: { [S1]: { [DAY]: mine } },
    ghosts: { [S1]: { [DAY]: [{ slot: "16:20", status, units: null }] } },
    dayAxis: {},
    derived: {},
    derivedActive: false,
    stats: {
      totalStudents: 1,
      presentRate: 0,
      presentCount: 0,
      absentCount: 0,
      lateCount: 0,
      makeupCount: 0,
      totalRecords: 0,
    },
  };
  const groups: MatrixGroup[] = [{ classId: C, className: "중등E_중2 정규 A", subjectLabel: "영어", matrix }];
  const ordered = [{ classId: C, studentId: S1 }];
  const src = buildGridSource(groups, DAYS, ordered);
  return (
    <AttendanceScopeProvider scope={{ teacherId: T, classIds: [C] }}>
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
      </GridProvider>
    </AttendanceScopeProvider>
  );
}
const cellAt = (c: HTMLElement) => c.querySelector<HTMLElement>(`[data-cell-key$="${DAY}"]`)!;

/**
 * 칸의 툴팁은 **카드**다(원장 2026-09-15) — 옛 `title` 검사 자리를 그대로 잇는다.
 * `statusOf` = 카드의 '상태' 줄(칸이 무슨 상태로 보이는가).
 */
const statusOf = (el: HTMLElement) => tipRow(el.getAttribute("data-tip"), "상태");

describe("🔴 팝오버 '출석' — 교시가 둘인 칸도 격자 타이핑과 같은 값으로 칠한다(리뷰 2026-09-11)", () => {
  it("칠한 값 = 2 = 서버 합 · 저장엔 강사 보기가 실린다 · 서버 값 2로 새로고침되면 덮개가 벗겨진다", async () => {
    const actions = await import("@/features/attendance/server/actions");
    vi.mocked(actions.setAttendanceCell).mockClear();
    const { container, rerender } = render(build("absent", null));
    expect(cellAt(container).textContent).toBe("0"); // 내 교시 둘 다 결석

    fireEvent.contextMenu(cellAt(container));
    fireEvent.click(screen.getByRole("button", { name: "출석" }));
    // 낙관 반영 — 시수를 비운 '출석' = 교시마다 기본(1) → 내 교시 둘의 합 2(종전엔 1로 칠했다).
    expect(cellAt(container).textContent).toBe("2");
    await waitFor(() => expect(actions.setAttendanceCell).toHaveBeenCalledTimes(1));
    expect(vi.mocked(actions.setAttendanceCell).mock.calls[0]![0]).toMatchObject({
      status: "present",
      units: "",
      scopeTeacherId: T,
    });
    // 성공 보정 — 서버 자동 시수가 없으니 칠한 그 값이 결과다.
    await waitFor(() => expect(cellAt(container).textContent).toBe("2"));

    rerender(build("present", 2)); // 저장 응답의 새로고침 — 서버 합 2(내 교시 둘 × 기본 1)
    expect(cellAt(container).textContent).toBe("2");
    // 덮개가 벗겨졌는지 — 그 뒤 다른 화면이 결석으로 되돌리면 칸이 그대로 따라간다(덮개가 남았으면 2에 굳는다).
    rerender(build("absent", null));
    await waitFor(() => expect(cellAt(container).textContent).toBe("0"));
    expect(statusOf(cellAt(container))).toBe("결석");
  });

  it('🔴 쉼표 소수점 "1,5"도 격자 타이핑과 같은 정규화 — 1.5로 칠하고(NaN·무한 렌더 없음) 서버 1.5에 덮개가 벗겨진다', async () => {
    const actions = await import("@/features/attendance/server/actions");
    vi.mocked(actions.setAttendanceCell).mockClear();
    const { container, rerender } = render(build("absent", null));
    fireEvent.contextMenu(cellAt(container));
    fireEvent.change(screen.getByLabelText("시수"), { target: { value: "1,5" } });
    fireEvent.click(screen.getByRole("button", { name: "출석" }));
    // 원문 그대로면 Number("1,5") = NaN → 스냅샷이 매번 새것이라 "Maximum update depth exceeded"로 화면이 떨어졌다.
    expect(cellAt(container).textContent).toBe("1.5");
    await waitFor(() => expect(actions.setAttendanceCell).toHaveBeenCalledTimes(1));
    // 서버엔 원문 그대로 — 서버 parseSessionUnits가 같은 규칙(쉼표 소수점)으로 읽는다.
    expect(vi.mocked(actions.setAttendanceCell).mock.calls[0]![0]).toMatchObject({ status: "present", units: "1,5" });
    await waitFor(() => expect(cellAt(container).textContent).toBe("1.5"));

    rerender(build("present", 1.5, [0.8, 0.7])); // 서버: 내 교시 둘에 0.8·0.7 = 합 1.5
    expect(cellAt(container).textContent).toBe("1.5");
    rerender(build("absent", null)); // 덮개가 벗겨졌으면 그 뒤 서버 값을 그대로 따라간다
    await waitFor(() => expect(cellAt(container).textContent).toBe("0"));
  });

  it("같은 입력이면 격자 타이핑도 같은 값 — 격자에 1을 쳐도 칸은 2(교시마다 기본)", async () => {
    const { container } = render(build("absent", null));
    fireEvent.mouseDown(cellAt(container), { button: 0 });
    fireEvent.keyDown(cellAt(container), { key: "1" });
    fireEvent.keyDown(cellAt(container), { key: "Enter" });
    await waitFor(() => expect(cellAt(container).textContent).toBe("2"));
  });
});
