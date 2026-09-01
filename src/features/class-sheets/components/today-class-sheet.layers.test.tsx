import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TodayClassSheet } from "./today-class-sheet";
import type { ClassSheetWeekData } from "../server/queries";
import type { GridDay, GridSlot } from "../lib/grid";
import type { SheetHandlers } from "./sheet-client";
import type { SheetSaveStore } from "./use-sheet-saves";

/**
 * 🔴 **한 장의 격자 = 한 배열**. 오늘 면은 위층(계획 카드)·아래층(통합 로스터)·일괄(DayBulk)·보강 추가가
 * 전부 같은 `day.slots`를 봐야 한다 — 어느 한 층이 스스로 교시를 거르면 위아래 세로선이 어긋나고
 * (today-columns 계약) 일괄 버튼 라벨이 화면과 다른 수를 말한다(원장 2026-08-18 "학생수 × 교시수").
 *
 * 2026-08-19 오늘 면이 **내 교시만** 그리게 되면서 이 계약이 처음으로 실제 위험이 됐다: 거르는 곳은
 * 오케스트레이터(sheet-client) 하나여야 하고, 여기서는 받은 배열을 **그대로** 나눠 줘야 한다.
 */
const seen = {
  periods: [] as string[],
  roster: [] as string[],
  bulk: [] as string[],
  makeupExisting: [] as string[],
};

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/ui/drag-scroll-area", () => ({
  DragScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("./period-block", () => ({
  PeriodBlock: ({ slot }: { slot: GridSlot }) => {
    seen.periods.push(slot.slotStart);
    return <div>계획칸</div>;
  },
}));
vi.mock("./today-roster-table", () => ({
  TodayRosterTable: ({ day }: { day: GridDay }) => {
    seen.roster.push(...day.slots.map((s) => s.slotStart));
    return <div>로스터표</div>;
  },
}));
vi.mock("./day-bulk", () => ({
  DayBulk: ({ slots }: { slots: { slotStart: string }[] }) => {
    seen.bulk.push(...slots.map((s) => s.slotStart));
    return <button type="button">일괄</button>;
  },
}));
vi.mock("./ecs-makeup-adder", () => ({
  EcsMakeupAdder: ({ existingIds }: { existingIds: ReadonlySet<string> }) => {
    seen.makeupExisting.push(...existingIds);
    return <button type="button">보강</button>;
  },
}));

beforeEach(() => {
  seen.periods = [];
  seen.roster = [];
  seen.bulk = [];
  seen.makeupExisting = [];
});
afterEach(cleanup);

function slot(slotStart: string, studentIds: string[]): GridSlot {
  return {
    slotStart,
    slotEnd: null,
    scheduled: true,
    teacherId: null,
    teacherLabel: null,
    roomLabel: null,
    lines: [],
    roster: studentIds.map((studentId) => ({ studentId, eligible: true, historical: false })),
  };
}

const data = {
  classId: "c1",
  canMarkAttendanceByDate: { "2026-08-19": true },
  // 보강 어댑터가 교시 이름을 여기서 뽑는다(서버가 항상 채우는 값) — 빼면 그 줄에서 죽는다.
  periodLabelBySlot: {},
  isEie: false,
} as unknown as ClassSheetWeekData;

function renderDay(day: GridDay) {
  return render(
    <TodayClassSheet
      day={day}
      data={data}
      linesBySlot={{}}
      marks={{}}
      attendance={{}}
      store={{} as SheetSaveStore}
      handlers={{} as SheetHandlers}
      canEdit
      collapsedGroups={[]}
      shouting={{}}
      onToggleGroup={vi.fn()}
    />,
  );
}

describe("오늘 면 시트 — 모든 층이 같은 day.slots를 본다", () => {
  it("🔴 넘긴 교시 그대로 계획 층·로스터 층·일괄에 전달된다(층이 스스로 거르지 않는다)", () => {
    renderDay({
      date: "2026-08-19",
      dow: "wed",
      holiday: null,
      slots: [slot("15:20", ["s1", "s2"]), slot("16:20", ["s1"])],
    });
    expect(seen.periods).toEqual(["15:20", "16:20"]);
    expect(seen.roster).toEqual(["15:20", "16:20"]);
    expect(seen.bulk).toEqual(["15:20", "16:20"]);
  });

  it("🔴 오케스트레이터가 교시를 걸러 내려보내면 세 층이 **함께** 줄어든다(일괄 라벨의 근거)", () => {
    // 위 케이스에서 '14:20'(남의 교시)이 빠진 모양 — 층마다 따로 거르면 여기서 수가 갈린다.
    renderDay({ date: "2026-08-19", dow: "wed", holiday: null, slots: [slot("15:20", ["s1", "s2"])] });
    expect(seen.periods).toEqual(["15:20"]);
    expect(seen.roster).toEqual(["15:20"]);
    expect(seen.bulk).toEqual(["15:20"]);
  });

  it("보강 추가의 '이미 있는 학생'도 같은 배열에서 나온다(보이는 교시의 명단 합집합)", () => {
    renderDay({
      date: "2026-08-19",
      dow: "wed",
      holiday: null,
      slots: [slot("15:20", ["s1", "s2"]), slot("16:20", ["s3"])],
    });
    expect([...seen.makeupExisting].sort()).toEqual(["s1", "s2", "s3"]);
  });
});
