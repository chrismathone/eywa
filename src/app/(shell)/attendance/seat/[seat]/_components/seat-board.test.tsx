import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SeatClassRoster } from "@/features/attendance/seat/server/queries";
import { SeatBoard } from "./seat-board";
import { writeLockedNote } from "@/lib/write-lock";

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
/** 계획 블록은 저널·presence·저장 큐를 들고 있어 여기선 **올라왔는지**만 본다(마운트마다 반 id를 적는다). */
const { planMounts, conflictFor } = vi.hoisted(() => ({
  planMounts: [] as string[],
  /** 반 id → 올라오자마자 알릴 저장 충돌 수(없으면 안 알린다). */
  conflictFor: {} as Record<string, number>,
}));
vi.mock("@/features/class-sheets/components/slot-plan-block", async () => {
  const { useEffect } = await import("react");
  return {
    SlotPlanBlock: ({ classId, onConflicts }: { classId: string; onConflicts?: (n: number) => void }) => {
      useEffect(() => {
        planMounts.push(classId);
      }, [classId]);
      useEffect(() => {
        if (conflictFor[classId]) onConflicts?.(conflictFor[classId]!);
      }, [classId, onConflicts]);
      return <section data-testid={`plan-${classId}`}>수업계획</section>;
    },
  };
});

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

/** 반 둘 — '전체' 보기의 **반별** 접기(원장 2026-09-18)를 보려면 한 교시에 카드가 둘 이상이어야 한다. */
const twoRosters: SeatClassRoster[] = [
  rosters[0]!,
  { ...rosters[0]!, classId: "c2", className: "중등E_초6 MED α", students: [] },
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

describe("JJ실 '전체' 보기 — 수업계획은 **반마다** 접은 채(원장 2026-09-18 \"펼치기\" · \"각각의 수업이 펼치기 접기\")", () => {
  const plans = {
    plans: {
      c1: { classId: "c1", canEdit: true, showExamTerm: true, skillAreas: [], lines: [] },
      c2: { classId: "c2", canEdit: true, showExamTerm: true, skillAreas: [], lines: [] },
    },
    tenantId: "t1",
    userId: "u1",
    weekMonday: "2026-08-10",
  };
  const base = {
    seat: "jj" as const,
    date: "2026-08-14",
    periods: [],
    activeStart: "16:20",
    rosters,
    readOnly: false,
    hrefFor: "/attendance/seat/jj?date=2026-08-14&start=",
  };

  it("접힌 채 시작하고 블록을 올리지도 않는다 — 누르면 펼치고, 다시 누르면 **감추기만** 한다(다시 올리지 않는다)", () => {
    planMounts.length = 0;
    render(<SeatBoard {...base} showChips={false} foldPlans plans={plans} />);
    expect(screen.queryByTestId("plan-c1")).toBeNull();
    expect(planMounts).toHaveLength(0);

    const toggle = screen.getByRole("button", { name: "수업계획 모두 펼치기 · 1개 반" });
    fireEvent.click(toggle);
    expect(screen.getByTestId("plan-c1")).toBeVisible();
    expect(screen.getByRole("button", { name: "수업계획 모두 접기" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "수업계획 모두 접기" }));
    // 🔴 내리지 않는다 — 다시 올리면 첫 화면의 서버 줄로 되살아나 방금 고친 칸이 옛 값이 된다.
    expect(screen.getByTestId("plan-c1")).not.toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "수업계획 모두 펼치기 · 1개 반" }));
    expect(screen.getByTestId("plan-c1")).toBeVisible();
    expect(planMounts).toEqual(["c1"]);
  });

  it("🔴 반마다 따로 편다 — 한 반을 펴도 옆 반은 접힌 채(원장 2026-09-18 \"각각의 수업이 펼치기 접기가 되어야함\")", () => {
    planMounts.length = 0;
    render(<SeatBoard {...base} rosters={twoRosters} showChips={false} foldPlans plans={plans} />);
    // 카드마다 접기 줄 하나 — 접근 이름에 **반 이름**이 붙는다(같은 이름의 버튼이 교시×반만큼 서지 않게).
    expect(screen.getAllByRole("button", { name: /수업계획 펼치기$/ })).toHaveLength(2);
    const c1 = screen.getByRole("button", { name: "중등E_초5 의치대 수업계획 펼치기" });
    expect(c1).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(c1);
    expect(screen.getByTestId("plan-c1")).toBeVisible();
    // 옆 반은 올리지도 않는다 — 블록마다 저널·저장 큐·presence가 붙는다.
    expect(screen.queryByTestId("plan-c2")).toBeNull();
    expect(planMounts).toEqual(["c1"]);
    expect(screen.getByRole("button", { name: "중등E_초5 의치대 수업계획 접기" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "중등E_초6 MED α 수업계획 펼치기" })).toHaveAttribute("aria-expanded", "false");

    // '모두 펼치기'는 **남은** 반을 센다(일부만 열린 상태에서 "2개 반"이라 적으면 거짓) — 누르면 남은 반까지 편다.
    fireEvent.click(screen.getByRole("button", { name: "수업계획 모두 펼치기 · 1개 반" }));
    expect(screen.getByTestId("plan-c2")).toBeVisible();
    expect(screen.getByRole("button", { name: "수업계획 모두 접기" })).toBeTruthy();
  });

  it("🔴 반별 접힘에 저장 충돌이 있으면 그 카드 버튼이 붉게 말한다 — 옆 반 충돌을 제 것으로 적지 않는다", () => {
    conflictFor.c2 = 3;
    try {
      render(<SeatBoard {...base} rosters={twoRosters} showChips={false} foldPlans plans={plans} />);
      fireEvent.click(screen.getByRole("button", { name: "수업계획 모두 펼치기 · 2개 반" }));
      fireEvent.click(screen.getByRole("button", { name: "수업계획 모두 접기" }));
      // 접근 이름에도 건수가 실린다(화면 글자와 같은 말).
      const btn = screen.getByRole("button", { name: "중등E_초6 MED α 수업계획 펼치기 · 저장 충돌 3건" });
      expect(btn.textContent).toContain("저장 충돌 3건");
      expect(btn.className).toContain("text-danger");
      // 충돌이 없는 반은 그냥 '펼치기' — 남의 충돌 수를 옮겨 적지 않는다.
      const other = screen.getByRole("button", { name: "중등E_초5 의치대 수업계획 펼치기" });
      expect(other.textContent).not.toContain("충돌");
      expect(other.className).not.toContain("text-danger");
    } finally {
      delete conflictFor.c2;
    }
  });

  it("🔴 접은 계획에 저장 충돌이 있으면 버튼이 그 수를 붉게 말한다 — 접힌 블록 안에 충돌을 가두지 않는다", () => {
    conflictFor.c1 = 2;
    try {
      render(<SeatBoard {...base} showChips={false} foldPlans plans={plans} />);
      fireEvent.click(screen.getByRole("button", { name: "수업계획 모두 펼치기 · 1개 반" }));
      fireEvent.click(screen.getByRole("button", { name: "수업계획 모두 접기" }));
      const btn = screen.getByRole("button", { name: "수업계획 모두 펼치기 · 저장 충돌 2건" });
      expect(btn.className).toContain("text-danger");
      // ⚠️ 잠그지는 않는다 — 이 화면에서 못 푸는 충돌이 남으면 새로고침 전까지 영영 잠긴다.
      expect(btn).toBeEnabled();
      expect(screen.getByTestId("plan-c1")).not.toBeVisible();
      // 펼친 반의 충돌은 요약 칩에 안 더한다 — 블록 안에 보이는 것을 접힌 반 것처럼 적지 않는다(재리뷰 2026-09-18).
      fireEvent.click(screen.getByRole("button", { name: "중등E_초5 의치대 수업계획 펼치기 · 저장 충돌 2건" }));
      expect(screen.getByRole("button", { name: "수업계획 모두 접기" }).textContent).not.toContain("충돌");
    } finally {
      delete conflictFor.c1;
    }
  });

  it("교시 하나 보기는 종전대로 — 늘 펼친 채, 버튼 없음", () => {
    render(<SeatBoard {...base} periods={periods} plans={plans} />);
    expect(screen.getByTestId("plan-c1")).toBeVisible();
    expect(screen.queryByRole("button", { name: /수업계획/ })).toBeNull();
  });

  it("계획을 볼 수 있는 반이 없으면 펼칠 것이 없어 버튼을 안 세운다", () => {
    render(<SeatBoard {...base} showChips={false} foldPlans />);
    expect(screen.queryByRole("button", { name: /수업계획/ })).toBeNull();
  });

  it("안내 한 줄은 교시마다 반복하지 않는다 — 칩 줄을 바깥이 그리는 보기에선 보드가 안 적는다", () => {
    render(<SeatBoard {...base} showChips={false} foldPlans plans={plans} />);
    expect(screen.queryByText(/영어 시트 JJ 칸과 같은 기록/)).toBeNull();
  });
});

/** 보기만인 이유(원장 2026-11-05) — 권한 때문인지 날짜 때문인지 안내 문장이 갈린다(`seatReadOnlyNote`). */
describe("자리 출석부 — 보기만인 이유", () => {
  const base = {
    seat: "lab" as const,
    date: "2026-08-14",
    periods,
    activeStart: "16:20",
    rosters,
    readOnly: true,
    hrefFor: "/attendance/seat/lab?date=2026-08-14&start=",
  };

  it("🔴 읽기 권한이면 권한을 말하고 출결 단추를 그리지 않는다(상태 글자만)", () => {
    render(<SeatBoard {...base} readOnlyReason="permission" />);
    expect(screen.getByText(writeLockedNote("seat_attendance"))).toBeTruthy();
    expect(screen.queryByText(/지난 날짜는 보기만/)).toBeNull();
    expect(screen.queryByRole("button", { name: "이다윤A 출석" })).toBeNull();
  });

  it("이유를 안 주면 종전 의미(지난 날짜) — 잠긴 세 단추와 날짜 안내", () => {
    render(<SeatBoard {...base} />);
    expect(screen.getByText(/지난 날짜는 보기만/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "이다윤A 출석" })).toHaveProperty("disabled", true);
  });
});
