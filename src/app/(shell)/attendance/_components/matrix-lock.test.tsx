import { fireEvent, render, waitFor } from "@testing-library/react";
import { tipText } from "@/components/hover-tip/tip";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AttendanceMatrix } from "@/features/attendance/server/queries";
import { setAttendanceCell, setAttendanceRange } from "@/features/attendance/server/actions";
import { lockedMessage } from "@/features/attendance/lock-message";
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
/** 잠긴 칸(7일 창 밖) */
const LOCKED = "2026-07-01";
/** 아직 고칠 수 있는 칸 */
const OPEN = "2026-07-02";
const OPEN2 = "2026-07-03";
/** 이 날짜 **이전**은 강사가 못 고친다 — page.tsx가 KST 오늘에서 계산해 내려주는 값과 같은 모양. */
const LOCK_BEFORE = OPEN;

const DAYS: AttendanceMatrix["days"] = [
  { date: LOCKED, day: 1, dow: 3, label: "수", isWeekend: false, isToday: false },
  { date: OPEN, day: 2, dow: 4, label: "목", isWeekend: false, isToday: false },
  { date: OPEN2, day: 3, dow: 5, label: "금", isWeekend: false, isToday: false },
];

function matrix(): AttendanceMatrix {
  return {
    classes: [],
    selectedClassId: C,
    month: "2026-07",
    window: { kind: "month", scope: null, start: "2026-07-01", end: "2026-07-31", label: "2026년 7월", defId: null },
    days: DAYS,
    classDows: [3, 4, 5],
    students: [
      {
        id: S1,
        name: "이도윤",
        grade: "고1",
        school: "경명여중",
        enrolledAt: null,
        attendDows: [3, 4, 5],
        spans: [],
        badges: [],
      },
    ],
    // 세 날 모두 값이 있다 — 잠긴 칸에 "되돌아갈 원래 값"이 있는 실제 상황 그대로.
    marks: { [S1]: { [LOCKED]: "present", [OPEN]: "present", [OPEN2]: "present" } } as never,
    notes: {},
    units: {},
    slots: {},
    ghosts: {},
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
}

/**
 * 🔴 격자(GridProvider) **안에서** 눌러야 진짜 검증이다 — 잠금 경로는 문서 키보드 리스너에만 있다.
 * ⚠️ `lockBefore`를 GridProvider와 MatrixTable **둘 다에** 넘긴다(page.tsx와 같은 배선). 한쪽만 넘기면
 *    "툴팁은 잠겼다는데 격자는 안 잠겼다"처럼 화면 두 곳이 다른 말을 하는 상태를 테스트가 못 잡는다.
 */
function renderGrid(lockBefore: string | null = LOCK_BEFORE) {
  const groups: MatrixGroup[] = [{ classId: C, className: "고등개별", subjectLabel: "수학", matrix: matrix() }];
  const ordered = [{ classId: C, studentId: S1 }];
  const src = buildGridSource(groups, DAYS, ordered);
  return render(
    <GridProvider
      rows={src.rows}
      cols={src.cols}
      initial={src.initial}
      slotCounts={src.slotCounts}
      notMine={src.notMine}
      lockBefore={lockBefore}
    >
      <MatrixTable groups={groups} days={DAYS} holidays={{}} showGroups ordered={ordered} lockBefore={lockBefore} />
    </GridProvider>,
  );
}

const cellAt = (c: HTMLElement, date: string) => c.querySelector<HTMLElement>(`[data-cell-key$="${date}"]`)!;
const LOCK_TEXT = "수정 기간(7일)이 지나 고칠 수 없습니다";

/**
 * 강사(scoped)만 걸리는 7일 잠금 — 잠긴 칸에 값을 치면 **아무 말 없이 사라지던** 결함의 회귀 가드
 * (원장 제보 2026-08-20). 범위(writeMany)는 예전부터 "N칸은 … 건너뛰었습니다"로 알렸고 단건만 침묵이었다.
 */
/**
 * 칸의 툴팁은 **카드**다(원장 2026-09-15) — 옛 `title` 검사 자리를 그대로 잇는다.
 * `tipOf` = 카드를 한 줄로 편 글.
 */
const tipOf = (el: HTMLElement) => tipText(el.getAttribute("data-tip"));

describe("잠긴 칸(7일 경과) — 조용히 사라지지 않는다", () => {
  beforeEach(() => {
    vi.mocked(setAttendanceCell).mockClear();
    vi.mocked(setAttendanceRange).mockClear();
  });

  it("🔴 숫자를 쳐도 **버퍼가 안 열린다** — 열면 숫자가 보였다가 확정에서 조용히 되돌아간다", () => {
    const { container } = renderGrid();
    const cell = cellAt(container, LOCKED);
    fireEvent.mouseDown(cell, { button: 0 });
    fireEvent.keyDown(cell, { key: "1" });
    expect(container.querySelector("input")).toBeNull();
    fireEvent.keyDown(cell, { key: "Enter" }); // 확정을 눌러도 마찬가지
    expect(setAttendanceCell).not.toHaveBeenCalled();
    expect(container.textContent).toContain(LOCK_TEXT);
  });

  it("🔴 Delete도 사유를 띄운다 — 종전엔 writeOne이 조용히 반환했다", () => {
    const { container } = renderGrid();
    const cell = cellAt(container, LOCKED);
    fireEvent.mouseDown(cell, { button: 0 });
    fireEvent.keyDown(cell, { key: "Delete" });
    expect(setAttendanceCell).not.toHaveBeenCalled();
    expect(container.textContent).toContain(LOCK_TEXT);
  });

  it("🔴 붙여넣기(Ctrl+V) 단건도 사유를 띄운다 — 같은 종착지(writeOne)다", () => {
    const { container } = renderGrid();
    // 안 잠긴 칸에서 복사 → 잠긴 칸에 붙여넣기(실제 조작 순서 그대로).
    const open = cellAt(container, OPEN);
    fireEvent.mouseDown(open, { button: 0 });
    fireEvent.keyDown(open, { key: "c", ctrlKey: true });
    const cell = cellAt(container, LOCKED);
    fireEvent.mouseDown(cell, { button: 0 });
    fireEvent.keyDown(cell, { key: "v", ctrlKey: true });
    expect(setAttendanceCell).not.toHaveBeenCalled();
    expect(container.textContent).toContain(LOCK_TEXT);
  });

  it("🔴 툴팁과 격자 안내가 **같은 문장**이다 — 단일 소스(lock-message.ts)라 갈릴 수 없다", () => {
    const { container } = renderGrid();
    const cell = cellAt(container, LOCKED);
    expect(tipOf(cell)).toContain(lockedMessage(LOCKED, LOCK_BEFORE));
    fireEvent.mouseDown(cell, { button: 0 });
    fireEvent.keyDown(cell, { key: "5" });
    expect(container.querySelector('[role="alert"]')!.textContent).toBe(lockedMessage(LOCKED, LOCK_BEFORE));
  });

  it("안 잠긴 칸은 종전 그대로 — 입력칸이 열리고 저장된다(잠금 안내 없음)", () => {
    const { container } = renderGrid();
    const open = cellAt(container, OPEN);
    fireEvent.mouseDown(open, { button: 0 });
    fireEvent.keyDown(open, { key: "1" });
    expect(container.querySelector("input")).not.toBeNull();
    fireEvent.keyDown(open, { key: "Enter" });
    expect(setAttendanceCell).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain(LOCK_TEXT);
  });

  it("🔴 앵커가 잠긴 칸이어도 **범위는 죽지 않는다** — 함께 고른 정상 칸엔 들어가고 건너뛴 칸은 알린다", () => {
    const { container } = renderGrid();
    const locked = cellAt(container, LOCKED);
    fireEvent.mouseDown(locked, { button: 0 });
    fireEvent.keyDown(locked, { key: "ArrowRight", shiftKey: true }); // 잠긴 칸 + 안 잠긴 칸
    fireEvent.keyDown(locked, { key: "1" });
    expect(container.querySelector("input")).not.toBeNull(); // 범위는 앵커만 보고 막지 않는다
    fireEvent.keyDown(locked, { key: "Enter" });
    expect(setAttendanceCell).toHaveBeenCalledTimes(1); // 안 잠긴 1칸만
    // 종전 문장 그대로 — 잠금 안내를 새로 붙였다고 **중복으로** 말하지 않는다.
    expect(container.textContent).toContain("1칸은 수정 기간(7일)이 지나 건너뛰었습니다");
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
  });

  it("🔴 3칸 범위도 종전대로 — 잠긴 칸만 빠지고 나머지 2칸은 범위 저장된다", async () => {
    const { container } = renderGrid();
    const locked = cellAt(container, LOCKED);
    fireEvent.mouseDown(locked, { button: 0 });
    fireEvent.keyDown(locked, { key: "ArrowRight", shiftKey: true });
    fireEvent.keyDown(locked, { key: "ArrowRight", shiftKey: true });
    fireEvent.keyDown(locked, { key: "0" }); // 결석
    fireEvent.keyDown(locked, { key: "Enter" });
    expect(vi.mocked(setAttendanceRange).mock.calls[0]![0]!.cells).toHaveLength(2);
    expect(setAttendanceCell).not.toHaveBeenCalled();
    await waitFor(() => expect(container.textContent).toContain("건너뛰었습니다"));
  });

  it("관리자 화면(lockBefore=null)은 아무 칸도 안 잠긴다 — 잠금은 강사(scoped) 전용이다", () => {
    const { container } = renderGrid(null);
    const cell = cellAt(container, LOCKED);
    fireEvent.mouseDown(cell, { button: 0 });
    fireEvent.keyDown(cell, { key: "1" });
    expect(container.querySelector("input")).not.toBeNull();
    fireEvent.keyDown(cell, { key: "Enter" });
    expect(setAttendanceCell).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain(LOCK_TEXT);
  });
});
