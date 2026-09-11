import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SeatClassRoster } from "@/features/attendance/seat/server/queries";
import { SeatBoard } from "./seat-board";

const { setSeatJjField } = vi.hoisted(() => ({
  setSeatJjField: vi.fn().mockResolvedValue({ ok: true }),
}));

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
  fillSeatPrevAbsent: vi.fn(),
}));
vi.mock("@/features/attendance/seat/server/mark-actions", () => ({
  setSeatJjField,
}));

afterEach(() => {
  cleanup();
  setSeatJjField.mockReset();
  setSeatJjField.mockResolvedValue({ ok: true });
});

const rosters: SeatClassRoster[] = [
  {
    classId: "c1",
    className: "중등E_초5 의치대",
    end: "17:00",
    bgColor: null,
    textColor: null,
    students: [
      {
        id: "s1",
        name: "이다윤A",
        school: "칠성초",
        grade: "4",
        status: "present",
        recordedBy: null,
        fromSeat: false,
      note: null,
        attitude: null,
        listeningLevel: null,
        memorizedWords: null,
        progressNote: null,
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

  it("교시를 바꾸면 방금 적던 듣기 값이 다음 교시에 묻지 않는다", () => {
    const props = {
      seat: "jj" as const,
      date: "2026-08-14",
      periods: [
        { start: "16:20", ends: ["17:00"], classIds: ["c1"] },
        { start: "17:20", ends: ["18:00"], classIds: ["c1"] },
      ],
      rosters,
      readOnly: false,
      hrefFor: "/attendance/seat/jj?date=2026-08-14&start=",
    };
    const { rerender } = render(<SeatBoard {...props} activeStart="16:20" />);
    fireEvent.change(screen.getByLabelText("이다윤A 듣기 레벨"), { target: { value: "L3" } });
    expect(screen.getByLabelText("이다윤A 듣기 레벨")).toHaveValue("L3");
    rerender(<SeatBoard {...props} activeStart="17:20" />);
    expect(screen.getByLabelText("이다윤A 듣기 레벨")).toHaveValue("");
  });
});

describe("마지막 수업 — 원장 2026-09-11 'LAB이나 JJ가 마지막 수업인 학생들은 마지막 수업이라고 표시하자'", () => {
  const base = { date: "2026-08-14", periods, activeStart: "16:20", rosters, readOnly: false };

  it("랩실 카드 — 조회가 **확인한** 학생에게만 적고, 모르면 아무것도 안 적는다", () => {
    const href = "/attendance/seat/lab?date=2026-08-14&start=";
    const { rerender } = render(<SeatBoard seat="lab" {...base} hrefFor={href} lastByStudent={{ s1: true }} />);
    expect(screen.getByText("마지막 수업").getAttribute("title")).toContain("시간표 기준 오늘 남은 수업이 없습니다");

    // 🔴 모름(값 없음)이면 안 적는다 — 다음 행선지가 없다는 **부재**로 추측하지 않는다.
    rerender(<SeatBoard seat="lab" {...base} hrefFor={href} />);
    expect(screen.queryByText("마지막 수업")).toBeNull();

    // 다음 수업이 있으면 그쪽이 이긴다(둘은 함께 설 수 없다).
    rerender(
      <SeatBoard
        seat="lab"
        {...base}
        hrefFor={href}
        nextStartByStudent={{ s1: "17:20" }}
        nextRoomByStudent={{ s1: "본원304" }}
        lastByStudent={{ s1: true }}
      />,
    );
    expect(screen.queryByText("마지막 수업")).toBeNull();
    expect(screen.getByText("17:20 본원304 이동")).toBeTruthy();
  });

  it("JJ실 표도 같은 부품으로 적는다", () => {
    render(
      <SeatBoard
        seat="jj"
        {...base}
        hrefFor="/attendance/seat/jj?date=2026-08-14&start="
        lastByStudent={{ s1: true }}
      />,
    );
    expect(screen.getByText("마지막 수업")).toBeTruthy();
  });
});
