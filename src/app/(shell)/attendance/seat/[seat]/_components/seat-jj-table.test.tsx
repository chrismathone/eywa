import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SeatClassRoster } from "@/features/attendance/seat/server/queries";
import { SeatJjTable } from "./seat-jj-table";

afterEach(cleanup);

const roster: SeatClassRoster = {
  classId: "c1",
  className: "중등E_초5 의치대",
  end: "17:00",
  students: [
    {
      id: "s1",
      name: "이다윤A",
      school: "칠성초",
      grade: "4",
      status: null,
      recordedBy: null,
      fromSeat: false,
      listeningLevel: "L3",
      memorizedWords: null,
    },
  ],
};

describe("JJ실 출석부 표", () => {
  it("듣기 레벨·누적 암기 단어수 칸이 있고 시험 점수는 없다", () => {
    render(
      <SeatJjTable
        rosters={[roster]}
        statusOf={() => null}
        onSave={vi.fn()}
        onSaveField={vi.fn()}
        onFillClass={vi.fn()}
        readOnly={false}
        pending={false}
      />,
    );
    expect(screen.getByText("듣기 레벨")).toBeTruthy();
    expect(screen.getByText("누적 암기 단어수")).toBeTruthy();
    expect(screen.queryByText("시험 점수")).toBeNull();
    expect(screen.getByLabelText("이다윤A 듣기 레벨")).toHaveValue("L3");
  });

  it("칸을 고치면 그 필드만 넘긴다", () => {
    const onSaveField = vi.fn();
    render(
      <SeatJjTable
        rosters={[roster]}
        statusOf={() => null}
        onSave={vi.fn()}
        onSaveField={onSaveField}
        onFillClass={vi.fn()}
        readOnly={false}
        pending={false}
      />,
    );
    fireEvent.change(screen.getByLabelText("이다윤A 누적 암기 단어수"), { target: { value: "1200" } });
    expect(onSaveField).toHaveBeenCalledWith("c1", "s1", "memorizedWords", "1200");
  });

  it("반은 가로 칸에 나란히 놓고 학생은 반 안에서 세로로 둔다", () => {
    const other: SeatClassRoster = {
      ...roster,
      classId: "c2",
      className: "중등E_초등 브릿지 A",
      students: [{ ...roster.students[0]!, id: "s2", name: "김수민" }],
    };
    const { container } = render(
      <SeatJjTable
        rosters={[roster, other]}
        statusOf={() => null}
        onSave={vi.fn()}
        onSaveField={vi.fn()}
        onFillClass={vi.fn()}
        readOnly={false}
        pending={false}
      />,
    );
    expect((container.firstElementChild as HTMLElement).style.gridTemplateColumns).toBe(
      "repeat(2, minmax(240px, 1fr))",
    );
    expect(screen.getAllByRole("table")).toHaveLength(2);
    expect(screen.getByText("중등E_초5 의치대")).toBeTruthy();
    expect(screen.getByText("중등E_초등 브릿지 A")).toBeTruthy();
  });
});
