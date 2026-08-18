import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { toast } from "sonner";
import { DayBulk } from "./day-bulk";
import { countDayTargets, type DayBulkSlot, type DayBulkTarget } from "../lib/bulk";
import type { BasicAttendance } from "../lib/mark-cycle";

type BulkAttendanceFn = (targets: DayBulkTarget[], status: BasicAttendance) => void;

/**
 * 원장 2026-08-18: *"학생수는 6인데 일괄출석은 12"* → *"수업 개수가 곱해져서 12구나. 그럼 이렇게.
 * **일괄 출석 학생수x수업수 로 표기, 합산하지 말고**."*
 *
 * 라벨은 **범위**(6×3)를 말하고, 실제로 기록된 칸 수는 **누른 뒤 토스트**가 말한다.
 * 🔴 저장 대상(비파괴 = 빈 칸만)은 그대로다 — 바뀐 건 표기뿐이라는 걸 여기서 잠근다.
 * (2026-08-14의 "라벨 숫자 = 칸 수"를 뒤집은 결정이다.)
 */
vi.mock("sonner", () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const DATE = "2026-08-18";
const roster = ["a", "b", "c", "d", "e", "f"].map((studentId) => ({
  studentId,
  eligible: true,
  historical: false,
}));

const slots: DayBulkSlot[] = ["16:20", "17:20", "18:20"].map((slotStart) => ({
  slotStart,
  roster,
  lines: [],
  scheduled: true,
}));

function renderBulk(over?: {
  attendance?: Record<string, unknown>;
  onBulkAttendance?: Mock<BulkAttendanceFn>;
  slots?: DayBulkSlot[];
}) {
  const onBulkAttendance: Mock<BulkAttendanceFn> =
    over?.onBulkAttendance ?? vi.fn<BulkAttendanceFn>();
  render(
    <DayBulk
      date={DATE}
      slots={over?.slots ?? slots}
      marks={{}}
      attendance={
        (over?.attendance ?? {}) as Record<
          string,
          { status: string; note: string | null; units: number | null; slot: string | null }
        >
      }
      canEdit
      canMarkDate
      showExamTerm
      onBulkAttendance={onBulkAttendance}
      onBulkStatus={vi.fn()}
      onBulkPlanCells={vi.fn()}
    />,
  );
  return { onBulkAttendance };
}

describe("하루 일괄 — 라벨은 학생수 × 교시수", () => {
  it("🔴 '일괄 출석 6×3' — 곱한 값(18)을 적지 않는다", () => {
    renderBulk();
    const btn = screen.getByRole("button", { name: /일괄 출석/ });
    expect(btn.textContent).toBe("일괄 출석 6×3");
    expect(btn.textContent).not.toContain("18");
  });

  it("'일괄 태도'도 같은 표기 — 한 줄에 두 셈법이 섞이지 않게", () => {
    renderBulk();
    expect(screen.getByRole("button", { name: /일괄 태도/ }).textContent).toBe("일괄 태도 6×3");
  });

  it("이미 찍힌 칸이 있어도 라벨(범위)은 안 줄어든다 — 줄어드는 건 실제 기록 수뿐", () => {
    renderBulk({ attendance: { [`a|${DATE}|16:20`]: { status: "present" } } });
    expect(screen.getByRole("button", { name: /일괄 출석/ }).textContent).toBe("일괄 출석 6×3");
    // 툴팁이 그 차이를 미리 밝힌다(18 - 1 = 17칸).
    expect(screen.getByRole("button", { name: /일괄 출석/ }).getAttribute("title")).toContain(
      "기록 없는 17칸",
    );
  });

  it("누르면 **실제로 기록된 칸 수**를 토스트가 말한다(라벨과 다를 수 있다)", () => {
    const { onBulkAttendance } = renderBulk({
      attendance: { [`a|${DATE}|16:20`]: { status: "present" } },
    });
    fireEvent.click(screen.getByRole("button", { name: /일괄 출석/ }));
    // 저장 대상 산출은 그대로 — 빈 칸만(비파괴).
    expect(onBulkAttendance).toHaveBeenCalledTimes(1);
    const [targets, status] = onBulkAttendance.mock.calls[0];
    expect(status).toBe("present");
    expect(countDayTargets(targets)).toBe(17);
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("17칸 기록"));
  });

  it("예정되지 않은 교시는 범위에서 빠진다", () => {
    renderBulk({ slots: [...slots.slice(0, 2), { ...slots[2], scheduled: false }] });
    expect(screen.getByRole("button", { name: /일괄 출석/ }).textContent).toBe("일괄 출석 6×2");
  });

  it("전원 이미 기록됐으면 비활성 — 라벨의 범위 숫자는 그대로 남는다", () => {
    const attendance: Record<string, unknown> = {};
    for (const s of slots) for (const r of roster) attendance[`${r.studentId}|${DATE}|${s.slotStart}`] = { status: "present" };
    renderBulk({ attendance });
    const btn = screen.getByRole("button", { name: /일괄 출석/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe("일괄 출석 6×3");
  });
});
