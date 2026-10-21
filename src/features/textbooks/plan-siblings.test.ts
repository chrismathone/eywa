import { describe, expect, it } from "vitest";
import { expandPlans } from "./plan-expand";
import {
  MAX_SAME_BOOK_PLANS,
  ownsCell,
  picksOverlap,
  placeSameBookPlan,
  planLane,
  SAME_BOOK_FULL,
  SAME_BOOK_OVERLAP,
  SAME_BOOK_OVERLAP_MANY,
} from "./plan-siblings";
import type { MonthScheduleRow } from "@/features/class-sheets/lib/month-assemble";

describe("picksOverlap — 요일·시각 기준", () => {
  it("같은 요일·시각이면 자리가 달라도 겹친다", () => {
    expect(picksOverlap(["tue|17:20|1"], ["tue|17:20|2"])).toBe(true);
  });
  it("요일이 다르거나 시각이 다르면 안 겹친다", () => {
    expect(picksOverlap(["tue|17:20|1"], ["thu|17:20|1"])).toBe(false);
    expect(picksOverlap(["tue|17:20|1"], ["tue|16:20|1"])).toBe(false);
  });
  it("옛 축 배정(null)·요일 없는 옛 값은 넓게 겹친다", () => {
    expect(picksOverlap(null, ["tue|17:20|1"])).toBe(true);
    expect(picksOverlap(["17:20"], ["fri|17:20|1"])).toBe(true);
  });
});

describe("placeSameBookPlan", () => {
  const a = { id: "a", slotPicks: ["tue|17:20|1"] };
  const b = { id: "b", slotPicks: ["thu|17:20|1"] };
  const c = { id: "c", slotPicks: ["fri|17:20|1"] };

  it("형제가 없으면 새로 건다", () => {
    expect(placeSameBookPlan({ picks: ["tue|17:20|1"], siblings: [] })).toEqual({ kind: "insert" });
  });
  it("안 겹치면 새로 건다 — 3개까지", () => {
    expect(placeSameBookPlan({ picks: ["thu|17:20|1"], siblings: [a] })).toEqual({ kind: "insert" });
    expect(placeSameBookPlan({ picks: ["fri|17:20|1"], siblings: [a, b] })).toEqual({ kind: "insert" });
    expect(MAX_SAME_BOOK_PLANS).toBe(3);
    expect(placeSameBookPlan({ picks: ["sat|10:00|1"], siblings: [a, b, c] })).toEqual({ kind: "error", error: SAME_BOOK_FULL });
  });
  it("하나와 겹치면 그 배정을 갈아 끼운다(교시만 바꿔 다시 거는 종전 흐름) — 3개가 차 있어도", () => {
    expect(placeSameBookPlan({ picks: ["tue|17:20|1", "tue|17:20|2"], siblings: [a, b, c] })).toEqual({ kind: "update", id: "a" });
  });
  it("둘 이상과 겹치면 거절", () => {
    expect(placeSameBookPlan({ picks: ["tue|17:20|1", "thu|17:20|1"], siblings: [a, b] })).toEqual({
      kind: "error",
      error: SAME_BOOK_OVERLAP_MANY,
    });
  });
  it("id로 고칠 땐 자기 자신은 빼고, 다른 배정과 겹치면 거절", () => {
    expect(placeSameBookPlan({ picks: ["tue|17:20|2"], siblings: [a, b], selfId: "a" })).toEqual({ kind: "update", id: "a" });
    expect(placeSameBookPlan({ picks: ["thu|17:20|2"], siblings: [a, b], selfId: "a" })).toEqual({ kind: "error", error: SAME_BOOK_OVERLAP });
  });
});

describe("ownsCell — 형제가 있을 때만 고른 교시로 가른다", () => {
  it("형제 없음 = 그 교재 줄 전부", () => {
    expect(ownsCell({ slotPicks: ["tue|17:20|1"] }, false, "2026-10-23", "17:20")).toBe(true); // 금요일
  });
  it("형제 있음 = 고른 요일·시각만", () => {
    expect(ownsCell({ slotPicks: ["tue|17:20|1"] }, true, "2026-10-20", "17:20")).toBe(true); // 화요일
    expect(ownsCell({ slotPicks: ["tue|17:20|1"] }, true, "2026-10-23", "17:20")).toBe(false);
  });
});

describe("같은 교재 배정 둘 — 차수가 각각 돈다", () => {
  // 화·목 17:20 수업 반.
  const schedules: MonthScheduleRow[] = ["tue", "thu"].map((dayOfWeek) => ({
    dayOfWeek,
    startTime: "17:20:00",
    endTime: "18:20:00",
    validFrom: null,
    validTo: null,
    slotTeacherLabel: "Jane",
    slotRoomLabel: "301",
  }));
  const book = "11111111-1111-4111-8111-111111111111";
  const plans = [
    { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", textbook_id: book, slot_axis: "class", pace: "min25", term_mode: "regular", start_date: "2026-10-20", start_lesson_no: 1, slot_picks: ["tue|17:20|1"] },
    { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", textbook_id: book, slot_axis: "class", pace: "min25", term_mode: "regular", start_date: "2026-10-20", start_lesson_no: 1, slot_picks: ["thu|17:20|1"] },
  ];
  const run = (shifts: Record<string, "skip" | "advance"> | null) =>
    expandPlans({
      plans,
      books: new Map([[book, { title: "Grammar", pageTime: null, skillArea: "grammar", sessionCount: 20 }]]),
      lessonsByBook: new Map(),
      schedules,
      holidays: {},
      shifts,
      from: "2026-10-20",
      to: "2026-10-31",
    });

  it("화요일 배정과 목요일 배정이 각자 1차수부터", () => {
    const out = run(null);
    const no = (k: string) => out[k]?.map((l) => l.lessonNo);
    expect(no("2026-10-20|17:20")).toEqual([1]);
    expect(no("2026-10-22|17:20")).toEqual([1]);
    expect(no("2026-10-27|17:20")).toEqual([2]);
    expect(no("2026-10-29|17:20")).toEqual([2]);
  });

  it("한 배정의 줄 미룸은 그 배정만 민다(표식 키 = 배정 id)", () => {
    const out = run({ [`2026-10-20|17:20|${planLane(plans[0]!)}|1`]: "skip" });
    const no = (k: string) => out[k]?.map((l) => l.lessonNo);
    expect(no("2026-10-20|17:20")).toBeUndefined();
    expect(no("2026-10-27|17:20")).toEqual([1]);
    // 목요일 배정은 그대로
    expect(no("2026-10-22|17:20")).toEqual([1]);
    expect(no("2026-10-29|17:20")).toEqual([2]);
  });
});
