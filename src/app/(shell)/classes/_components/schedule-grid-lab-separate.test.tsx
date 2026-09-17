import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScheduleGrid } from "./schedule-grid";

const PERIODS = [
  { id: "1", startTime: "16:20", endTime: "17:20", label: "1교시" },
  { id: "2", startTime: "17:20", endTime: "18:10", label: "2교시" },
];

function renderGrid(opts: { enabled: boolean; labSeparate?: boolean; seat?: string | null }) {
  const { container } = render(
    <form>
      <ScheduleGrid
        weekdayPeriods={PERIODS}
        weekendPeriods={[]}
        initial={[
          { dayOfWeek: "tue", startTime: "16:20", endTime: "17:20", slotTeacherLabel: opts.seat === undefined ? "LAB" : opts.seat, labSeparate: opts.labSeparate },
          { dayOfWeek: "tue", startTime: "17:20", endTime: "18:10", teacherId: null },
        ]}
        teacherId={null}
        teacherOptions={[]}
        classroomOptions={[]}
        allowSeats
        labSeparateEnabled={opts.enabled}
      />
    </form>,
  );
  fireEvent.click(screen.getByRole("button", { name: /교시별 부담임\/강의실 설정/ }));
  const hidden = (name: string) => container.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  return { container, hidden };
}

describe("반 수정 — 랩실 옆 '따로 수업(*LAB)' 토글 (원장 2026-09-17)", () => {
  it("LAB 교시 옆에만 토글이 서고, 켜면 격자 칸이 `*LAB`(밑줄·이탤릭)이 되며 값을 보낸다", () => {
    const { hidden } = renderGrid({ enabled: true });
    const toggle = screen.getByRole("button", { name: "화 1교시 따로 수업(*LAB)" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    // 담임(강사) 교시엔 토글이 없다.
    expect(screen.queryByRole("button", { name: "화 2교시 따로 수업(*LAB)" })).toBeNull();
    expect(hidden("schedule_labsep_0")!.value).toBe("0");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(hidden("schedule_labsep_0")!.value).toBe("1");
    expect(hidden("schedule_labsep_1")!.value).toBe("0");
    const cell = screen.getByRole("button", { name: "화 1교시" });
    expect(cell).toHaveTextContent("*LAB");
    expect(cell.querySelector("span")!.className).toContain("underline");
  });

  it("저장된 표식으로 켜진 채 열린다", () => {
    const { hidden } = renderGrid({ enabled: true, labSeparate: true });
    expect(screen.getByRole("button", { name: "화 1교시 따로 수업(*LAB)" })).toHaveAttribute("aria-pressed", "true");
    expect(hidden("schedule_labsep_0")!.value).toBe("1");
  });

  it("🔴 표식을 못 읽은 폼(labSeparateEnabled=false)은 토글도 값도 없다 — 서버가 기존 값을 승계한다", () => {
    const { hidden } = renderGrid({ enabled: false, labSeparate: true });
    expect(screen.queryByRole("button", { name: /따로 수업/ })).toBeNull();
    expect(hidden("schedule_labsep_0")).toBeNull();
    // 표식 모름 = 칸도 평소 LAB으로 그린다(켜진 줄 알고 보여 주지 않는다).
    expect(screen.getByRole("button", { name: "화 1교시" }).textContent).toBe("LAB");
  });
});

describe("초안 복원 — 자리가 라벨이 아니라 담당 칸 값(seat:LAB)으로만 와도 표식이 살아난다 (리뷰 2026-09-17)", () => {
  it("teacherId=seat:LAB + labSeparate → 토글 켜진 채·값 1", () => {
    const { container } = render(
      <form>
        <ScheduleGrid
          weekdayPeriods={PERIODS}
          weekendPeriods={[]}
          initial={[{ dayOfWeek: "tue", startTime: "16:20", endTime: "17:20", teacherId: "seat:LAB", labSeparate: true }]}
          teacherId={null}
          teacherOptions={[]}
          classroomOptions={[]}
          allowSeats
          labSeparateEnabled
        />
      </form>,
    );
    expect(container.querySelector<HTMLInputElement>('input[name="schedule_labsep_0"]')!.value).toBe("1");
    expect(screen.getByRole("button", { name: "화 1교시" }).textContent).toBe("*LAB");
  });
});
