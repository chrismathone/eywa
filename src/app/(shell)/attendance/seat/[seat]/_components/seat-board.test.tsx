import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SeatClassRoster } from "@/features/attendance/seat/server/queries";
import { SeatBoard } from "./seat-board";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/features/attendance/seat/server/actions", () => ({
  setSeatCell: vi.fn(),
  fillSeatSlot: vi.fn(),
}));
vi.mock("@/features/attendance/seat/server/mark-actions", () => ({
  setSeatJjField: vi.fn(),
}));

afterEach(cleanup);

const rosters: SeatClassRoster[] = [
  {
    classId: "c1",
    className: "중등E_초5 의치대",
    end: "17:00",
    students: [
      {
        id: "s1",
        name: "이다윤A",
        school: "칠성초",
        grade: "4",
        status: "present",
        recordedBy: null,
        fromSeat: false,
        listeningLevel: null,
        memorizedWords: null,
      },
    ],
  },
];

const periods = [{ start: "16:20", ends: ["17:00"], classIds: ["c1"] }];

describe("자리 출석부 본문", () => {
  it("JJ실만 듣기·단어 칸을 그린다", () => {
    const { rerender } = render(
      <SeatBoard
        seat="jj"
        date="2026-08-14"
        periods={periods}
        activeStart="16:20"
        rosters={rosters}
        readOnly={false}
        hrefFor="/attendance/seat/jj?date=2026-08-14&start="
      />,
    );
    expect(screen.getByText("듣기 레벨")).toBeTruthy();
    expect(screen.getByText("누적 암기 단어수")).toBeTruthy();
    expect(screen.getByText(/영어 시트 JJ 칸과 같은 기록/)).toBeTruthy();

    rerender(
      <SeatBoard
        seat="lab"
        date="2026-08-14"
        periods={periods}
        activeStart="16:20"
        rosters={rosters}
        readOnly={false}
        hrefFor="/attendance/seat/lab?date=2026-08-14&start="
      />,
    );
    expect(screen.queryByText("듣기 레벨")).toBeNull();
    expect(screen.queryByText("누적 암기 단어수")).toBeNull();
  });
});
