/**
 * '출결 모드' 화면 — **터치 수 계약**과 **저장 축**을 잠근다.
 *
 * 원장 2026-08-20(정정): 결석 2터치 · 지각 3터치. 실데이터가 그 순서다(결석 974 vs 지각 29).
 * 🔴 여기서 깨지면 조용히 틀린다:
 *    · 지각이 '지각' 탭만으로 저장되면 **확인 안 한 시각**이 메모로 남는다.
 *    · 결석이 사유를 골라야 저장되면 **사유 없는 결석이 아예 안 찍힌다**(2터치의 뜻이 사라진다).
 *    · 저장 축이 화면 교시로 새면 영어 반 시수가 두 배가 된다(→ 급여).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { LiveBoard, LiveBoardSlot, LiveStudent } from "../../live/types";
import { quickClasses } from "../board";
import { QuickBoard } from "./quick-board";

type CellInput = Record<string, unknown>;
type CellResult = { ok: true } | { error: string };
type BulkResult =
  | { ok: true; applied: { studentId: string; classId: string }[]; blocked: number }
  | { error: string };

/** 구현은 beforeEach가 채운다 — 여기선 **호출 인자**만 본다(저장 축·source·noteOnly). */
const setCell = vi.fn<(input: CellInput) => Promise<CellResult>>();
const setBulk = vi.fn<(input: CellInput) => Promise<BulkResult>>();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock("@/features/attendance/server/actions", () => ({
  setAttendanceCell: (input: CellInput) => setCell(input),
  setAttendanceBulk: (input: CellInput) => setBulk(input),
}));
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (m: string) => toastError(m), success: vi.fn(), info: vi.fn() },
}));

afterEach(cleanup);
beforeEach(() => {
  setCell.mockClear();
  setCell.mockResolvedValue({ ok: true });
  setBulk.mockClear();
  setBulk.mockResolvedValue({ ok: true, applied: [], blocked: 0 });
  toastError.mockClear();
  refresh.mockClear();
});

const student = (name: string, over: Partial<LiveStudent> = {}): LiveStudent => ({
  studentId: name,
  studentName: name,
  englishName: null,
  schoolGrade: "경명여중2",
  parentPhone: null,
  studentPhone: null,
  status: null,
  note: null,
  signal: null,
  ...over,
});

const slot = (over: Partial<LiveBoardSlot> & { classId: string; className: string }): LiveBoardSlot => ({
  key: `${over.classId}@${over.slotStart ?? "16:20"}`,
  subject: "math",
  slotStart: "16:20",
  saveSlot: null,
  slotEnd: "17:20",
  periodLabel: null,
  teacherId: "t1",
  teacherName: "김강사",
  slotTeacherLabel: null,
  roomName: "601호",
  students: [],
  hasAnyRecord: false,
  recordedCount: 0,
  phase: "due",
  band: "now",
  ownedByMe: true,
  ...over,
});

const boardOf = (slots: LiveBoardSlot[]): LiveBoard => ({
  date: "2026-08-20",
  isToday: true,
  scopedToSelf: true,
  canEdit: true,
  totals: { expected: 0, recorded: 0, slots: slots.length },
  teachers: [
    { teacherId: "t1", seatLabel: null, teacherName: "김강사", teacherPhone: null, slots, expected: 0, recorded: 0 },
  ],
});

/** 수학 한 반(저장 축 null) — 기본 무대. */
function renderMath(students: LiveStudent[] = [student("이도윤"), student("박서준")]) {
  const classes = quickClasses(boardOf([slot({ classId: "c1", className: "초등M BS1B", students })]));
  render(<QuickBoard date="2026-08-20" classes={classes} canEdit />);
}

const chip = (name: string) => screen.getByRole("button", { name: new RegExp(name) });
const bigButton = (label: string) => screen.getByRole("button", { name: label });

describe("출석 — 2터치(칩 → 출석)", () => {
  it("저장 축·source를 그대로 실어 한 번만 부르고 시트를 닫는다", async () => {
    renderMath();
    fireEvent.click(chip("이도윤"));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(bigButton("출석"));
    await waitFor(() => expect(setCell).toHaveBeenCalledTimes(1));
    expect(setCell.mock.calls[0]![0]).toMatchObject({
      studentId: "이도윤",
      classId: "c1",
      sessionDate: "2026-08-20",
      status: "present",
      slotStart: null, // 수학 = 그날 전체(slot-axis)
      periodStart: "16:20", // 화면 교시 = 데스크 10분 판정 축
      source: "live",
    });
    // 빈 칸이었으므로 메모는 건드리지 않는다(undefined = 서버가 기존 메모 유지).
    expect("note" in setCell.mock.calls[0]![0]).toBe(false);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("낙관 반영이 요약 숫자에 즉시 반영된다", async () => {
    renderMath();
    expect(screen.getByText(/미출결/).textContent).toContain("2");
    fireEvent.click(chip("이도윤"));
    fireEvent.click(bigButton("출석"));
    await waitFor(() => expect(screen.getByText(/미출결/).textContent).toContain("1"));
  });
});

describe("결석 — 2터치(칩 → 결석), 사유는 선택", () => {
  it("🔴 '결석'을 누르는 순간 사유 없이 저장된다 — 사유 단계가 저장을 막지 않는다", async () => {
    renderMath();
    fireEvent.click(chip("이도윤"));
    fireEvent.click(bigButton("결석"));
    await waitFor(() => expect(setCell).toHaveBeenCalledTimes(1));
    expect(setCell.mock.calls[0]![0]).toMatchObject({ status: "absent", slotStart: null, source: "live" });
    // 시트는 열린 채 사유 칩만 남는다 — 안 고르고 닫아도 결석은 이미 남아 있다.
    expect(screen.getByText(/결석으로 기록했습니다/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "여행" })).toBeTruthy();
  });

  it("사유 칩은 **메모만** 갱신한다(noteOnly) — 방금 저장한 상태·시수를 덮지 않는다", async () => {
    renderMath();
    fireEvent.click(chip("이도윤"));
    fireEvent.click(bigButton("결석"));
    await waitFor(() => expect(setCell).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "가족여행" }));
    await waitFor(() => expect(setCell).toHaveBeenCalledTimes(2));
    expect(setCell.mock.calls[1]![0]).toMatchObject({
      noteOnly: true,
      note: "가족여행",
      slotStart: null,
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("지각 — 3터치(칩 → 지각 → 저장)", () => {
  it("🔴 '지각'만 눌러서는 액션이 안 나간다 — 시각을 보고 넘기는 단계다", async () => {
    renderMath();
    fireEvent.click(chip("이도윤"));
    fireEvent.click(bigButton("지각"));
    expect(setCell).not.toHaveBeenCalled();
    // 확인 단계 = 자동으로 채워진 등원 시각 + 저장 버튼.
    expect((screen.getByLabelText("등원 시각") as HTMLInputElement).value).toMatch(/^\d{2}:\d{2}$/);
    expect(screen.getByRole("button", { name: "지각 저장" })).toBeTruthy();
  });

  it("'지각 저장'을 눌러야 `HH:MM 등원`으로 기록된다", async () => {
    renderMath();
    fireEvent.click(chip("이도윤"));
    fireEvent.click(bigButton("지각"));
    fireEvent.change(screen.getByLabelText("등원 시각"), { target: { value: "17:05" } });
    fireEvent.click(screen.getByRole("button", { name: "지각 저장" }));
    await waitFor(() => expect(setCell).toHaveBeenCalledTimes(1));
    expect(setCell.mock.calls[0]![0]).toMatchObject({ status: "late", note: "17:05 등원" });
  });

  it("사유 칩을 고르면 메모 뒤에 붙는다(4터치)", async () => {
    renderMath();
    fireEvent.click(chip("이도윤"));
    fireEvent.click(bigButton("지각"));
    fireEvent.change(screen.getByLabelText("등원 시각"), { target: { value: "17:05" } });
    fireEvent.click(screen.getByRole("button", { name: "버스 놓침" }));
    expect(setCell).not.toHaveBeenCalled(); // 아직 저장 전
    fireEvent.click(screen.getByRole("button", { name: "지각 저장" }));
    await waitFor(() => expect(setCell).toHaveBeenCalledTimes(1));
    expect(setCell.mock.calls[0]![0]).toMatchObject({ note: "17:05 등원 · 버스 놓침" });
  });

  it("±5분이 시각을 옮긴다", () => {
    renderMath();
    fireEvent.click(chip("이도윤"));
    fireEvent.click(bigButton("지각"));
    fireEvent.change(screen.getByLabelText("등원 시각"), { target: { value: "17:05" } });
    fireEvent.click(screen.getByRole("button", { name: "등원 시각 5분 앞으로" }));
    expect((screen.getByLabelText("등원 시각") as HTMLInputElement).value).toBe("17:00");
  });
});

describe("거절 — 조용히 되돌리지 않는다", () => {
  it("서버가 거절하면 한글 사유를 화면·토스트로 알리고 낙관 반영을 되돌린다", async () => {
    setCell.mockResolvedValue({ error: "7일이 지난 출결은 수정할 수 없습니다" });
    renderMath();
    fireEvent.click(chip("이도윤"));
    fireEvent.click(bigButton("결석")); // 결석은 시트가 열린 채라 화면에서도 사유가 보여야 한다
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("7일이 지난 출결은 수정할 수 없습니다"));
    expect(screen.getByText("7일이 지난 출결은 수정할 수 없습니다")).toBeTruthy();
    // 되돌림 — 미출결 수가 원래대로.
    await waitFor(() => expect(screen.getByText(/미출결/).textContent).toContain("2"));
  });
});

describe("일괄 출결", () => {
  it("미입력 칸만·라벨 숫자대로·fillEmptyOnly로 한 번 부른다", async () => {
    renderMath([student("이도윤"), student("박서준", { status: "absent" }), student("이서현")]);
    const bulk = screen.getByRole("button", { name: /일괄 출결/ });
    expect(bulk.textContent).toContain("2");
    fireEvent.click(bulk);
    await waitFor(() => expect(setBulk).toHaveBeenCalledTimes(1));
    expect(setBulk.mock.calls[0]![0]).toMatchObject({
      sessionDate: "2026-08-20",
      status: "present",
      fillEmptyOnly: true,
      slotStart: null,
      periodStart: "16:20",
      source: "live",
    });
    const cells = setBulk.mock.calls[0]![0].cells as { studentId: string }[];
    expect(cells.map((c) => c.studentId)).toEqual(["이도윤", "이서현"]);
  });

  it("대상이 0이면 비활성 — 눌러보기 전에 안다", () => {
    renderMath([student("이도윤", { status: "present" })]);
    const bulk = screen.getByRole("button", { name: /일괄 출결/ });
    expect(bulk.hasAttribute("disabled")).toBe(true);
    fireEvent.click(bulk);
    expect(setBulk).not.toHaveBeenCalled();
  });
});

describe("읽기 전용", () => {
  it("쓰기 권한이 없으면 칩을 눌러도 시트가 안 열리고 일괄 버튼이 없다", () => {
    const classes = quickClasses(
      boardOf([slot({ classId: "c1", className: "초등M BS1B", students: [student("이도윤")] })]),
    );
    render(<QuickBoard date="2026-08-20" classes={classes} canEdit={false} />);
    expect(screen.queryByRole("button", { name: /일괄 출결/ })).toBeNull();
    fireEvent.click(chip("이도윤"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("적대적 리뷰에서 잡은 것", () => {
  it("🔴 결석이 거절되면 '결석으로 기록했습니다'·사유 칩이 남지 않는다 — 화면이 거짓말하지 않게", async () => {
    setCell.mockResolvedValue({ error: "담당 반이 아닙니다" });
    renderMath();
    fireEvent.click(chip("이도윤"));
    fireEvent.click(bigButton("결석"));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(screen.queryByText(/결석으로 기록했습니다/)).toBeNull();
    expect(screen.queryByRole("button", { name: "여행" })).toBeNull();
    // 시트는 열린 채 사유만 보여 준다(사유 칩을 누르면 noteOnly가 또 거절될 자리를 아예 없앤다).
    expect(screen.getByText("담당 반이 아닙니다")).toBeTruthy();
  });

  it("시트가 닫힌 채 실패하면 거절 사유가 **띠로** 남는다 — 토스트는 지나간다", async () => {
    setBulk.mockResolvedValue({ error: "7일이 지난 출결은 수정할 수 없습니다" });
    renderMath();
    fireEvent.click(screen.getByRole("button", { name: /일괄 출결/ }));
    await waitFor(() => expect(screen.getByText("7일이 지난 출결은 수정할 수 없습니다")).toBeTruthy());
  });

  it("🔴 일괄이 일부만 적용되면 서버 진실로 되맞춘다 — 건너뛴 칸을 빈 칸으로 남기지 않는다", async () => {
    setBulk.mockResolvedValue({
      ok: true,
      applied: [{ studentId: "이도윤", classId: "c1" }],
      blocked: 1,
    });
    renderMath();
    fireEvent.click(screen.getByRole("button", { name: /일괄 출결/ }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("전부 적용되면 되맞추지 않는다 — 탭마다 왕복을 늘리지 않는다", async () => {
    setBulk.mockResolvedValue({
      ok: true,
      applied: [
        { studentId: "이도윤", classId: "c1" },
        { studentId: "박서준", classId: "c1" },
      ],
      blocked: 0,
    });
    renderMath();
    fireEvent.click(screen.getByRole("button", { name: /일괄 출결/ }));
    await waitFor(() => expect(setBulk).toHaveBeenCalledTimes(1));
    expect(refresh).not.toHaveBeenCalled();
  });
});
