import { describe, expect, it } from "vitest";
import type { MonthScheduleRow } from "@/features/class-sheets/lib/month-assemble";
import { buildLessonSchedule } from "@/features/textbooks/lesson-schedule";
import {
  blockCarryOffsets,
  carryConflicts,
  carryConflictText,
  carryGapDates,
  carryGroups,
  carryKeepsOrder,
  carryOffset,
  carryRounds,
  carrySlotPicks,
  carrySummary,
  dayPaceKeepsDays,
  mondayOf,
  parseSlotMemoKey,
  picksConflictText,
  shiftYmd,
  slotMemoKey,
  weekdayOf,
  type CarryItem,
} from "./slot-carry";

/** 2026-11-02 = 월요일 · 11-04 = 수요일 · 11-05 = 목요일. */
const item = (over: Partial<CarryItem>): CarryItem => ({
  table: "class_sheet_plan_lines",
  label: "수업 계획",
  id: "p1",
  fromDate: "2026-11-05",
  fromSlot: "16:00:00",
  toDate: "2026-11-05",
  toSlot: "17:00:00",
  keyRest: "regular|1",
  slotInKey: true,
  until: null,
  ...over,
});

describe("날짜 도우미", () => {
  it("요일·날짜 더하기·주 월요일·교시 메모 열쇠", () => {
    expect(weekdayOf("2026-11-02")).toBe("mon");
    expect(weekdayOf("2026-11-08")).toBe("sun");
    expect(shiftYmd("2026-12-30", 3)).toBe("2027-01-02");
    expect(shiftYmd("2026-03-01", -1)).toBe("2026-02-28");
    expect(mondayOf("2026-11-08")).toBe("2026-11-02");
    expect(mondayOf("2026-11-02")).toBe("2026-11-02");
    expect(slotMemoKey("2026-11-05", "16:00:00")).toBe("slot:2026-11-05:16:00");
    expect(parseSlotMemoKey("slot:2026-11-05:16:00")).toEqual({ date: "2026-11-05", slot: "16:00:00" });
    expect(parseSlotMemoKey("day:2026-11-05")).toBeNull();
  });
});

describe("함께 옮기는 날짜(carryOffset) — 같은 주의 새 요일 · (가)안: 적용일보다 앞이면 다음 주", () => {
  it("시각만 바뀌면 날짜 그대로", () => {
    expect(carryOffset("thu", "thu", "2026-11-04")).toEqual({ days: 0, pushedWeek: false });
  });

  it("요일이 뒤로 가면 같은 주 안", () => {
    // 월 → 수, 적용일 수(11/4): 첫 월요일은 11/9 → 11/11(수).
    expect(carryOffset("mon", "wed", "2026-11-04")).toEqual({ days: 2, pushedWeek: false });
    expect(shiftYmd("2026-11-09", 2)).toBe("2026-11-11");
  });

  it("🔴 (가) 요일이 앞당겨져 같은 주 날짜가 적용일 앞이면 다음 주 — 줄 전체가 한 주씩 밀린다", () => {
    // 목 → 월, 적용일 수(11/4): 11/5(목) → 같은 주 월 11/2는 적용일 앞 → 11/9(월) · 11/12(목) → 11/16(월).
    const o = carryOffset("thu", "mon", "2026-11-04");
    expect(o).toEqual({ days: 4, pushedWeek: true });
    expect(shiftYmd("2026-11-05", o.days)).toBe("2026-11-09");
    expect(shiftYmd("2026-11-12", o.days)).toBe("2026-11-16");
    // 적용일이 목요일 당일이어도 같다.
    expect(carryOffset("thu", "mon", "2026-11-05")).toEqual({ days: 4, pushedWeek: true });
  });

  it("적용일을 그 주 월요일로 잡으면 밀리지 않는다", () => {
    expect(carryOffset("thu", "mon", "2026-11-02")).toEqual({ days: -3, pushedWeek: false });
    expect(shiftYmd("2026-11-05", -3)).toBe("2026-11-02");
    // 일 → 월(같은 주 월~일): 11/8(일) → 11/2(월).
    expect(carryOffset("sun", "mon", "2026-11-02")).toEqual({ days: -6, pushedWeek: false });
  });

  it("🔴 어떤 요일·적용일이든 옮긴 날짜는 적용일 이후 · 새 요일 · 7일 안쪽(앞으로 6일 ~ 뒤로 13일)", () => {
    const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
    for (let e = 0; e < 7; e++) {
      const effective = shiftYmd("2026-11-02", e);
      for (const from of days) {
        for (const to of days) {
          const o = carryOffset(from, to, effective);
          expect(o.days).toBeGreaterThanOrEqual(-6);
          expect(o.days).toBeLessThanOrEqual(13);
          for (let k = 0; k < 21; k++) {
            const d = shiftYmd(effective, k);
            if (weekdayOf(d) !== from) continue;
            const moved = shiftYmd(d, o.days);
            expect(moved >= effective).toBe(true);
            expect(weekdayOf(moved)).toBe(to);
          }
        }
      }
    }
  });

  it("요일 값이 틀리면 던진다", () => {
    expect(() => carryOffset("monday", "tue", "2026-11-02")).toThrow();
  });
});

describe("🔴 블록 단위 한 주 밀림(blockCarryOffsets) — 두 요일 블록의 수업 차례가 뒤집히지 않는다(적대 리뷰 2026-10-28)", () => {
  /** 적용일부터 4주치 옛 회차를 옮긴 뒤 날짜순으로 세워, 옮기기 전 날짜순과 같은지 본다. */
  const order = (rows: { from: string; to: string }[], effective: string) => {
    const { days, pushed } = blockCarryOffsets(
      rows.map((r) => ({ fromDay: r.from, toDay: r.to, fromSlot: "16:00:00", toSlot: "16:00:00" })),
      effective,
    );
    const sessions: { old: string; moved: string }[] = [];
    for (let k = 0; k < 28; k++) {
      const d = shiftYmd(effective, k);
      rows.forEach((r, n) => {
        if (weekdayOf(d) === r.from) sessions.push({ old: d, moved: shiftYmd(d, days[n]!) });
      });
    }
    const byOld = [...sessions].sort((a, b) => a.old.localeCompare(b.old)).map((s) => s.old);
    const byMoved = [...sessions].sort((a, b) => a.moved.localeCompare(b.moved)).map((s) => s.old);
    return { byOld, byMoved, days, pushed, sessions };
  };

  it("재현 1: 화·금 → 월·목, 적용일 금 11/6 — 블록 전체가 한 주 밀려 차례가 그대로", () => {
    const r = order([{ from: "tue", to: "mon" }, { from: "fri", to: "thu" }], "2026-11-06");
    expect(r.pushed).toBe("all");
    expect(r.days).toEqual([6, 6]);
    expect(r.byMoved).toEqual(r.byOld);
    // 금 11/6 → 목 11/12 · 화 11/10 → 월 11/16(옛 규칙은 11/9로 금 11/6 회차보다 앞에 왔다).
    expect(r.sessions.find((s) => s.old === "2026-11-06")?.moved).toBe("2026-11-12");
    expect(r.sessions.find((s) => s.old === "2026-11-10")?.moved).toBe("2026-11-16");
    expect(r.sessions.every((s) => s.moved >= "2026-11-06")).toBe(true);
  });

  it("재현 2: 수·토 → 월·목, 적용일 금 11/6 — 차례가 그대로", () => {
    const r = order([{ from: "wed", to: "mon" }, { from: "sat", to: "thu" }], "2026-11-06");
    expect(r.pushed).toBe("all");
    expect(r.byMoved).toEqual(r.byOld);
  });

  it("줄별 날짜가 이미 차례를 지키면 블록을 밀지 않는다 — 목·토 → 토·월(둘 다 +2일), 적용일 수 11/4(재리뷰 2026-10-28)", () => {
    const r = order([{ from: "thu", to: "sat" }, { from: "sat", to: "mon" }], "2026-11-04");
    expect(r.days).toEqual([2, 2]);
    expect(r.pushed).toBe("some");
    expect(r.byMoved).toEqual(r.byOld);
  });

  it("🔴 요일 순서대로 옮기는 두·세 요일 블록은 어떤 적용일이든 차례가 그대로 · 적용일 이후 · 새 요일(전수)", () => {
    const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
    const pairs: [number, number][] = [];
    for (let a = 0; a < 7; a++) for (let b = a + 1; b < 7; b++) pairs.push([a, b]);
    for (let e = 0; e < 7; e++) {
      const effective = shiftYmd("2026-11-02", e);
      for (const [fa, fb] of pairs) {
        for (const [ta, tb] of pairs) {
          const rows = [
            { from: DAYS[fa]!, to: DAYS[ta]! },
            { from: DAYS[fb]!, to: DAYS[tb]! },
          ];
          const r = order(rows, effective);
          expect(r.byMoved).toEqual(r.byOld);
          for (const s of r.sessions) {
            expect(s.moved >= effective).toBe(true);
          }
          expect(
            carryKeepsOrder(
              rows.map((x, n) => ({ fromDay: x.from, fromSlot: "16:00:00", toSlot: "16:00:00", days: r.days[n]! })),
              effective,
            ),
          ).toBe(true);
        }
      }
    }
  });

  it("한 줄도 안 밀리면 그대로 · 제자리 줄도 블록이 밀리면 함께 7일", () => {
    const at = (fromDay: string, toDay: string) => ({ fromDay, toDay, fromSlot: "16:00:00", toSlot: "16:00:00" });
    expect(blockCarryOffsets([at("mon", "wed"), at("thu", "fri")], "2026-11-04")).toEqual({ days: [2, 1], pushed: "none" });
    // [월, 목] → [월, 수], 적용일 목 11/5: 목→수가 밀리므로 월 줄도 +7(안 밀면 월 11/9 회차가 목 11/5 회차보다 앞에 온다).
    expect(blockCarryOffsets([at("mon", "mon"), at("thu", "wed")], "2026-11-05")).toEqual({ days: [7, 6], pushed: "all" });
  });

  it("carryKeepsOrder — 요일 순서를 뒤바꾸는 이동(화·금 → 목·월)은 거짓 · 같은 날 교시 순서도 본다", () => {
    const eff = "2026-11-02";
    const swap = [
      { fromDay: "tue", fromSlot: "16:00:00", toSlot: "16:00:00", days: 2 }, // 화 11/3 → 목 11/5
      { fromDay: "fri", fromSlot: "16:00:00", toSlot: "16:00:00", days: -4 }, // 금 11/6 → 같은 주 월 11/2(화 회차보다 앞)
    ];
    expect(carryKeepsOrder(swap, eff)).toBe(false);
    // 금 → 다음 주 월(+3)이면 차례는 그대로다(화3→목5 · 금6→월9).
    expect(carryKeepsOrder([swap[0]!, { ...swap[1]!, days: 3 }], eff)).toBe(true);
    // 같은 요일 16·17시를 17·16시로 맞바꾸면 거짓, 16·17 → 17·18이면 참.
    expect(
      carryKeepsOrder(
        [
          { fromDay: "mon", fromSlot: "16:00:00", toSlot: "17:00:00", days: 0 },
          { fromDay: "mon", fromSlot: "17:00:00", toSlot: "16:00:00", days: 0 },
        ],
        eff,
      ),
    ).toBe(false);
    expect(
      carryKeepsOrder(
        [
          { fromDay: "mon", fromSlot: "16:00:00", toSlot: "17:00:00", days: 0 },
          { fromDay: "mon", fromSlot: "17:00:00", toSlot: "18:00:00", days: 0 },
        ],
        eff,
      ),
    ).toBe(true);
  });
});

describe("🔴 교재 배정 고른 교시(carrySlotPicks) — 옛 칸은 두고 새 칸을 더한다 · 틀려지는 경우는 막는다(적대 리뷰 2026-10-28)", () => {
  const plan = (id: string, picks: string[], textbookId = "b1") => ({ id, textbookId, startDate: "2026-09-01", picks });
  const sched = (day: string, start: string, validFrom: string | null, validTo: string | null) => ({ day, start: `${start}:00`, validFrom, validTo });
  const EFF = "2026-11-09";

  it("목 16:20 → 금 17:20: 자리 번호를 그대로 더하고 옛 칸은 남긴다 · 다른 칸 배정은 그대로", () => {
    const r = carrySlotPicks({
      plans: [plan("p1", ["thu|16:20|1", "thu|16:20|2", "mon|17:20"]), plan("p2", ["mon|17:20"], "b2")],
      moves: [{ fromDay: "thu", fromStart: "16:20", toDay: "fri", toStart: "17:20" }],
      schedules: [sched("thu", "16:20", null, null), sched("mon", "17:20", null, null)],
      effective: EFF,
    });
    expect(r.conflicts).toEqual([]);
    expect(r.changes).toEqual([
      { id: "p1", prev: ["thu|16:20|1", "thu|16:20|2", "mon|17:20"], next: ["fri|17:20|1", "fri|17:20|2", "mon|17:20", "thu|16:20|1", "thu|16:20|2"] },
    ]);
  });

  it("자리 없는 옛 값도 따라가고 · 제자리 줄(요일·시각 그대로)은 더하지 않는다", () => {
    const r = carrySlotPicks({
      plans: [plan("p1", ["tue|17:20", "fri|17:20"])],
      moves: [
        { fromDay: "tue", fromStart: "17:20", toDay: "mon", toStart: "17:20" },
        { fromDay: "fri", fromStart: "17:20", toDay: "fri", toStart: "17:20" },
      ],
      schedules: [],
      effective: EFF,
    });
    expect(r.changes[0]?.next).toEqual(["fri|17:20", "mon|17:20", "tue|17:20"]);
  });

  it("🔴 연쇄 이동(16→17 · 17→18)에서 17시만 고른 배정은 막는다(taken) · 16·17을 다 고른 배정은 통과", () => {
    const moves = [
      { fromDay: "mon", fromStart: "16:00", toDay: "mon", toStart: "17:00" },
      { fromDay: "mon", fromStart: "17:00", toDay: "mon", toStart: "18:00" },
    ];
    const schedules = [sched("mon", "16:00", null, null), sched("mon", "17:00", null, null)];
    const only17 = carrySlotPicks({ plans: [plan("b", ["mon|17:00"])], moves, schedules, effective: EFF });
    expect(only17.conflicts.map((c) => [c.kind, c.cell])).toEqual([["taken", "mon|17:00"]]);
    // 16시만 고른 배정 — 17시를 더하면 그 반의 지난 17시 수업까지 세게 된다(past).
    const only16 = carrySlotPicks({ plans: [plan("a", ["mon|16:00"])], moves, schedules, effective: EFF });
    expect(only16.conflicts.map((c) => [c.kind, c.cell])).toEqual([["past", "mon|17:00"]]);
    const both = carrySlotPicks({ plans: [plan("ab", ["mon|16:00", "mon|17:00"])], moves, schedules, effective: EFF });
    expect(both.conflicts).toEqual([]);
    expect(both.changes[0]?.next).toEqual(["mon|16:00", "mon|17:00", "mon|18:00"]);
  });

  it("past — 배정 시작 전에 끝난 배치는 상관없다 · 적용일부터 시작하는 배치도 상관없다", () => {
    const moves = [{ fromDay: "thu", fromStart: "16:20", toDay: "fri", toStart: "17:20" }];
    const base = { plans: [plan("p1", ["thu|16:20"])], moves, effective: EFF };
    expect(carrySlotPicks({ ...base, schedules: [sched("fri", "17:20", "2026-03-01", "2026-08-31")] }).conflicts).toEqual([]);
    expect(carrySlotPicks({ ...base, schedules: [sched("fri", "17:20", EFF, null)] }).conflicts).toEqual([]);
    expect(carrySlotPicks({ ...base, schedules: [sched("fri", "17:20", "2026-03-01", "2026-09-30")] }).conflicts.map((c) => c.kind)).toEqual([
      "past",
    ]);
  });

  it("dayless · full · sibling", () => {
    const move = [{ fromDay: "thu", fromStart: "16:20", toDay: "fri", toStart: "17:20" }];
    expect(carrySlotPicks({ plans: [plan("p", ["16:20"])], moves: move, schedules: [], effective: EFF }).conflicts.map((c) => c.kind)).toEqual([
      "dayless",
    ]);
    const many = Array.from({ length: 48 }, (_, n) => `sat|${String(8 + Math.floor(n / 4)).padStart(2, "0")}:${["00", "15", "30", "45"][n % 4]}`);
    many[0] = "thu|16:20";
    expect(carrySlotPicks({ plans: [plan("p", many)], moves: move, schedules: [], effective: EFF }).conflicts.map((c) => c.kind)).toEqual(["full"]);
    // 같은 교재 두 배정: A는 목 16:20, B는 금 17:20 — A가 금 17:20을 더하면 둘이 겹친다(B는 도착 칸을 이미 골라 taken도 함께).
    const sib = carrySlotPicks({
      plans: [plan("a", ["thu|16:20"]), plan("b", ["fri|17:20"])],
      moves: move,
      schedules: [],
      effective: EFF,
    });
    expect(sib.conflicts.map((c) => [c.kind, c.planId])).toEqual([
      ["taken", "b"],
      ["sibling", "a"],
    ]);
  });

  it("막힘 안내는 교재 이름 · 칸 · 할 일을 말한다", () => {
    const text = picksConflictText(
      [
        { planId: "b", textbookId: "t1", kind: "taken", cell: "mon|17:00" },
        { planId: "b", textbookId: "t1", kind: "taken", cell: "mon|17:00" },
        { planId: "a", textbookId: "t2", kind: "past", cell: "fri|17:20" },
      ],
      (id) => ({ t1: "Reading 1", t2: "Grammar" })[id] ?? "?",
    );
    expect(text).toContain("「Reading 1」 배정이 옮겨 갈 교시(월 17:00)를 이미 골라 두어");
    expect(text).toContain("「Grammar」 배정에 금 17:20 교시를 더하면");
    expect(text.match(/Reading 1/g)).toHaveLength(1);
    // 교재목록엔 교시를 고치는 칸이 없다 — 할 수 있는 일만 권한다(재리뷰 2026-10-28).
    expect(text).toContain("다른 자리로 옮기거나, 그 배정을 지우고 옮긴 뒤 다시 걸어 주세요");
    expect(text).not.toContain("교시를 먼저 정리");
  });

  it("🔴 연쇄 이동(한 교시 뒤로 밀기)은 따로 알린다 — 교재목록에서 고쳐도 안 풀리니 겹치지 않는 시각·다른 요일을 권한다", () => {
    const moves = [
      { fromDay: "mon", fromStart: "16:00", toDay: "mon", toStart: "17:00" },
      { fromDay: "mon", fromStart: "17:00", toDay: "mon", toStart: "18:00" },
    ];
    const r = carrySlotPicks({
      plans: [plan("a", ["mon|16:00"], "t1"), plan("b", ["mon|17:00"], "t2")],
      moves,
      schedules: [sched("mon", "16:00", null, null), sched("mon", "17:00", null, null)],
      effective: EFF,
    });
    expect(r.conflicts.every((c) => c.chain)).toBe(true);
    const text = picksConflictText(r.conflicts, (id) => ({ t1: "Reading", t2: "Grammar" })[id] ?? "?");
    expect(text).toContain("이어지는 교시를 한 칸씩 미는 이동이라(월 17:00)");
    expect(text).toContain("「Reading」·「Grammar」");
    expect(text).toContain("지금 교시와 겹치지 않는 시각이나 다른 요일로");
    expect(text).not.toContain("교재목록에서");
    // 겹치지 않는 시각(16·17 → 18·19)이면 통과.
    const apart = carrySlotPicks({
      plans: [plan("a", ["mon|16:00"], "t1"), plan("b", ["mon|17:00"], "t2")],
      moves: moves.map((m) => ({ ...m, toStart: m.fromStart === "16:00" ? "18:00" : "19:00" })),
      schedules: [sched("mon", "16:00", null, null), sched("mon", "17:00", null, null)],
      effective: EFF,
    });
    expect(apart.conflicts).toEqual([]);
    expect(apart.changes.map((c) => c.next)).toEqual([["mon|16:00", "mon|18:00"], ["mon|17:00", "mon|19:00"]]);
  });
});

describe("함께 옮기기 막힘 판정(carryConflicts)", () => {
  it("🔴 옮겨 갈 교시에 옮기지 않는 기록이 있으면 막는다 — 다른 줄 번호·다른 학생이어도 그 칸엔 이미 기록이 있다", () => {
    const c = carryConflicts(
      [item({})],
      [{ table: "class_sheet_plan_lines", id: "orphan", date: "2026-11-05", slot: "17:00:00", keyRest: "regular|3", slotInKey: true }],
    );
    expect(c).toEqual([{ label: "수업 계획", kind: "occupied", dates: ["2026-11-05"] }]);
  });

  it("함께 옮기는 기록이 비우는 자리는 차지한 것이 아니다(16→17시 · 17→18시를 함께 옮김)", () => {
    const a = item({ id: "a" });
    const b = item({ id: "b", fromSlot: "17:00:00", toSlot: "18:00:00" });
    const occupants = [
      { table: a.table, id: "a", date: "2026-11-05", slot: "16:00:00", keyRest: "regular|1", slotInKey: true },
      { table: a.table, id: "b", date: "2026-11-05", slot: "17:00:00", keyRest: "regular|1", slotInKey: true },
    ];
    expect(carryConflicts([a, b], occupants)).toEqual([]);
  });

  it("다른 표·다른 날짜의 기록은 상관없다", () => {
    const c = carryConflicts(
      [item({})],
      [
        { table: "class_sheet_student_marks", id: "m", date: "2026-11-05", slot: "17:00:00", keyRest: "s1", slotInKey: true },
        { table: "class_sheet_plan_lines", id: "x", date: "2026-11-06", slot: "17:00:00", keyRest: "regular|1", slotInKey: true },
      ],
    );
    expect(c).toEqual([]);
  });

  it("두 교시의 기록이 한 교시로 모이면 막는다", () => {
    const c = carryConflicts([item({ id: "a", fromSlot: "15:00:00" }), item({ id: "b", keyRest: "regular|2" })], []);
    expect(c).toEqual([{ label: "수업 계획", kind: "merge", dates: ["2026-11-05"] }]);
  });

  it("배치가 끝나는 날 뒤로 넘어가면 막는다(옛 날짜로 알린다)", () => {
    const c = carryConflicts([item({ fromDate: "2026-12-31", toDate: "2027-01-04", until: "2027-01-01" })], []);
    expect(c).toEqual([{ label: "수업 계획", kind: "beyond", dates: ["2026-12-31"] }]);
  });

  it("자리 이동은 교시가 열쇠에 없다 — 같은 날 같은 학생 기록이면(다른 교시여도) 막고, 다른 학생이면 통과", () => {
    const seat = (over: Partial<CarryItem>) =>
      item({ table: "seat_period_moves", label: "자리 이동", keyRest: "lab|s1", slotInKey: false, ...over });
    const other = (keyRest: string) => ({
      table: "seat_period_moves",
      id: "o",
      date: "2026-11-09",
      slot: "14:20:00",
      keyRest,
      slotInKey: false,
    });
    expect(carryConflicts([seat({ toDate: "2026-11-09" })], [other("lab|s1")])).toEqual([
      { label: "자리 이동", kind: "occupied", dates: ["2026-11-09"] },
    ]);
    expect(carryConflicts([seat({ toDate: "2026-11-09" })], [other("lab|s2")])).toEqual([]);
  });

  it("안내 글은 무엇이 어느 날인지 · 덮어쓰지 않았다는 것 · 종류마다 할 수 있는 일을 말한다(적대 리뷰 2026-10-28)", () => {
    const text = carryConflictText([
      { label: "수업 계획", kind: "occupied", dates: ["2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30"] },
      { label: "학생 기록", kind: "merge", dates: ["2026-11-09"] },
    ]);
    expect(text).toContain("옮겨 갈 교시에 이미 기록이 있습니다(수업 계획 11/9·11/16·11/23 외 1일)");
    expect(text).toContain("수업 시트에선 보이지 않을 수 있습니다"); // 자리 이동은 살아 있는 다른 교시 기록에도 걸린다 — 단정하지 않는다
    expect(text).toContain("두 교시의 기록이 한 교시로 겹칩니다(학생 기록 11/9) — 블록을 나눠");
    expect(text).toContain("덮어쓰거나 버리지 않으려고");
    expect(text).not.toContain("배치가 끝나는 날");
    // 배치 없는 칸의 기록은 화면에 없다 — "그 날짜의 기록을 확인"하라고 하지 않는다 · beyond는 적용일 바꾸기를 권하지 않는다.
    expect(text).not.toContain("기록을 확인하거나");
    const beyond = carryConflictText([{ label: "수업 계획", kind: "beyond", dates: ["2026-12-31"] }]);
    expect(beyond).toContain("배치가 끝나는 날을 늦추거나");
    expect(beyond).not.toContain("적용일");
  });
});

describe("옮기는 순서(carryRounds) · 묶음(carryGroups) · 요약(carrySummary)", () => {
  it("🔴 자리를 비울 기록부터 — 17→18시가 먼저, 16→17시가 다음(유니크가 도중에 안 부딪힌다)", () => {
    const a = item({ id: "a" }); // 16 → 17
    const b = item({ id: "b", fromSlot: "17:00:00", toSlot: "18:00:00" }); // 17 → 18
    expect(carryRounds([a, b])?.map((r) => r.map((i) => i.id))).toEqual([["b"], ["a"]]);
  });

  it("열쇠가 안 겹치면 한 단계 · 자기 자리로 가는 자리 이동(시각만 바뀜)도 한 단계", () => {
    const a = item({ id: "a" });
    const b = item({ id: "b", keyRest: "regular|2" });
    const seat = item({ id: "s", table: "seat_period_moves", keyRest: "lab|s1", slotInKey: false, toDate: "2026-11-05" });
    expect(carryRounds([a, b, seat])).toHaveLength(1);
    expect(carryRounds([])).toEqual([]);
  });

  it("순환이면 null(안전장치)", () => {
    const a = item({ id: "a" }); // 16 → 17
    const b = item({ id: "b", fromSlot: "17:00:00", toSlot: "16:00:00" }); // 17 → 16
    expect(carryRounds([a, b])).toBeNull();
  });

  it("같은 표·같은 출발·도착 칸끼리 한 번에 쓴다", () => {
    const groups = carryGroups([
      item({ id: "a" }),
      item({ id: "b", keyRest: "regular|2" }),
      item({ id: "c", fromDate: "2026-11-12", toDate: "2026-11-12" }),
    ]);
    expect(groups.map((g) => [g.toDate, g.ids])).toEqual([
      ["2026-11-05", ["a", "b"]],
      ["2026-11-12", ["c"]],
    ]);
    expect(groups[0]).toMatchObject({ label: "수업 계획", fromDate: "2026-11-05", fromSlot: "16:00:00", toSlot: "17:00:00" });
  });

  it("요약 — 표마다 건수 · 교재 배정 교시 · 한 주 밀림은 블록 전체로 읽히게 · 없으면 null", () => {
    const items = [item({ id: "a" }), item({ id: "b" }), item({ id: "m", table: "class_sheet_student_marks", label: "학생 기록" })];
    expect(carrySummary(items, "none")).toBe("함께 옮긴 기록: 수업 계획 2건 · 학생 기록 1건");
    expect(carrySummary(items, "all")).toContain("블록의 기록을 모두 한 주 뒤 같은 요일로");
    expect(carrySummary(items, "some")).toContain("앞선 요일의 기록은 한 주 뒤 같은 요일로");
    expect(carrySummary(items, "none", 2)).toBe("함께 옮긴 기록: 수업 계획 2건 · 학생 기록 1건 · 교재 배정 교시 2개");
    expect(carrySummary([], "all", 1)).toBe("함께 옮긴 기록: 교재 배정 교시 1개");
    expect(carrySummary(items, "none", 1, ["2026-11-09", "2026-11-09"])).toBe(
      "함께 옮긴 기록: 수업 계획 2건 · 학생 기록 1건 · 교재 배정 교시 1개 · 비워 둔 회차 11/9(미룸 표식)",
    );
    expect(carrySummary([], "all")).toBeNull();
  });
});

describe("🔴 비는 회차(carryGapDates) — 옮긴 뒤 교재 계산 = 옮긴 계획 줄(재리뷰 2026-10-28)", () => {
  const H = "2027-06-30"; // 마지막 계획 줄(넉넉히)
  const gaps = (i: { toDay: string; days: number; effective: string; until: string | null }) => carryGapDates({ ...i, horizon: H }).gaps;
  it("화→수, 적용일 수 11/4: 11/4 회차가 빈다(화 11/10 계획이 수 11/11로) · 밀림 없어도 생긴다", () => {
    expect(gaps({ toDay: "wed", days: 1, effective: "2026-11-04", until: null })).toEqual(["2026-11-04"]);
  });

  it("화·금 → 월·목, 적용일 금 11/6(블록 +6): 월 11/9 회차만 빈다 · 시각만 바뀌면 없다", () => {
    expect(gaps({ toDay: "mon", days: 6, effective: "2026-11-06", until: null })).toEqual(["2026-11-09"]);
    expect(gaps({ toDay: "thu", days: 6, effective: "2026-11-06", until: null })).toEqual([]);
    expect(gaps({ toDay: "thu", days: 0, effective: "2026-11-06", until: null })).toEqual([]);
  });

  it("배치가 끝나기 직전 새 요일이 앞당겨지면 마지막 새 회차도 빈다(옛 날짜가 끝나는 날 뒤)", () => {
    // 목 → 월(-3), 적용일 월 11/2, 끝나는 날 화 11/24: 월 11/23의 옛 날짜 목 11/26은 끝난 뒤.
    expect(gaps({ toDay: "mon", days: -3, effective: "2026-11-02", until: "2026-11-24" })).toEqual(["2026-11-23"]);
  });

  type Row = { day: string; start: string };
  /**
   * 9/1 시작 배정(80차수)을 옛 교시로 계산 → 적용일 이후 차수를 블록 날짜 규칙으로 옮긴 것(= 실제 계획 줄) ↔ 옮긴 뒤 배치·더한
   * 교시·비는 회차 미룸 표식으로 다시 계산한 것이 차수마다 같은 칸인가. 적용일 전 칸은 그대로인가.
   */
  const agree = (
    from: Row[],
    to: Row[],
    effective: string,
    opt: { holidays?: string[]; start?: string } = {},
  ): "passed" | "blocked" => {
    const START = opt.start ?? "2026-09-01";
    const holidays = opt.holidays ? Object.fromEntries(opt.holidays.map((d) => [d, "휴원"])) : null;
    const lessonNos = Array.from({ length: 80 }, (_, i) => i + 1);
    const row = (r: Row, validFrom: string | null, validTo: string | null): MonthScheduleRow => ({
      dayOfWeek: r.day,
      startTime: `${r.start}:00`,
      endTime: null,
      validFrom,
      validTo,
      slotTeacherLabel: "T",
      slotRoomLabel: null,
    });
    const picks = from.map((r) => `${r.day}|${r.start}`);
    const base = { startDate: START, lessonNos, holidays, axis: "class" as const, pace: "period" as const, lookaheadDays: 200 };
    const before = buildLessonSchedule({ ...base, schedules: from.map((r) => row(r, "2026-03-01", null)), slotPicks: picks });
    const block = blockCarryOffsets(
      from.map((r, n) => ({ fromDay: r.day, toDay: to[n]!.day, fromSlot: `${r.start}:00`, toSlot: `${to[n]!.start}:00` })),
      effective,
    );
    const picked = carrySlotPicks({
      plans: [{ id: "p", textbookId: "b", startDate: START, picks }],
      moves: from.map((r, n) => ({ fromDay: r.day, fromStart: r.start, toDay: to[n]!.day, toStart: to[n]!.start })),
      schedules: from.map((r) => ({ day: r.day, start: `${r.start}:00`, validFrom: "2026-03-01", validTo: null })),
      effective,
    });
    expect(picked.conflicts).toEqual([]);
    const shifts: Record<string, "skip"> = {};
    let blocked = false;
    to.forEach((r, n) => {
      const g = carryGapDates({ toDay: r.day, days: block.days[n]!, effective, until: null, horizon: shiftYmd(START, 200), holidays, starts: [START] });
      for (const d of g.gaps) shifts[`${d}|${r.start}`] = "skip";
      if (g.onHoliday.length > 0 || g.straddled.length > 0) blocked = true;
    });
    if (blocked) return "blocked";
    const cutoff = shiftYmd(effective, -1);
    const after = buildLessonSchedule({
      ...base,
      schedules: [...from.map((r) => row(r, "2026-03-01", cutoff)), ...to.map((r) => row(r, effective, null))],
      slotPicks: picked.changes[0]?.next ?? picks,
      shifts,
    });
    const lines = new Map(
      before.targets.map((t) => {
        if (t.date < effective) return [t.lessonNo, `${t.date}|${t.slotStart}`];
        const n = from.findIndex((r) => r.day === weekdayOf(t.date) && r.start === t.slotStart);
        return [t.lessonNo, `${shiftYmd(t.date, block.days[n]!)}|${to[n]!.start}`];
      }),
    );
    const horizon = shiftYmd(START, 170);
    let compared = 0;
    for (const t of after.targets) {
      const want = lines.get(t.lessonNo);
      if (t.date > horizon || !want || want.slice(0, 10) > horizon) continue;
      expect(`${t.lessonNo} ${t.date}|${t.slotStart}`).toBe(`${t.lessonNo} ${want}`);
      compared += 1;
    }
    expect(compared).toBeGreaterThan(opt.start ? 5 : 15); // 주 1회 블록도 170일이면 20회가 넘는다
    return "passed";
  };

  it("재현(지적 1의 사례): 화·금 17:20 → 월·목 17:20, 적용일 금 11/6", () => {
    agree([{ day: "tue", start: "17:20" }, { day: "fri", start: "17:20" }], [{ day: "mon", start: "17:20" }, { day: "thu", start: "17:20" }], "2026-11-06");
  });

  it("흔한 경우: 월·목 → 화·금(적용일 화 11/3) · 화 → 수(적용일 수 11/4) · 목 → 월(적용일 수 11/4, 한 주 밀림)", () => {
    agree([{ day: "mon", start: "16:00" }, { day: "thu", start: "16:00" }], [{ day: "tue", start: "16:00" }, { day: "fri", start: "16:00" }], "2026-11-03");
    agree([{ day: "tue", start: "17:20" }], [{ day: "wed", start: "17:20" }], "2026-11-04");
    agree([{ day: "thu", start: "17:20" }], [{ day: "mon", start: "17:20" }], "2026-11-04");
  });

  it("제자리 줄이 블록과 함께 밀림([월, 목] → [월, 수], 적용일 목 11/5) · 줄별 +2(목·토 → 토·월, 적용일 수 11/4) · 시각만(16·17 → 18·19)", () => {
    agree([{ day: "mon", start: "16:00" }, { day: "thu", start: "16:00" }], [{ day: "mon", start: "16:00" }, { day: "wed", start: "16:00" }], "2026-11-05");
    agree([{ day: "thu", start: "17:20" }, { day: "sat", start: "17:20" }], [{ day: "sat", start: "17:20" }, { day: "mon", start: "17:20" }], "2026-11-04");
    agree([{ day: "mon", start: "16:00" }, { day: "mon", start: "17:00" }], [{ day: "mon", start: "18:00" }, { day: "mon", start: "19:00" }], "2026-11-02");
  });

  it("🔴 요일 이동 전수(한 요일 블록 · 모든 요일 쌍 × 적용일 7가지)", () => {
    const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat"];
    for (let e = 0; e < 7; e++) {
      for (const a of DAYS) for (const b of DAYS) if (a !== b) agree([{ day: a, start: "17:20" }], [{ day: b, start: "17:20" }], shiftYmd("2026-11-02", e));
    }
  });

  it("🔴 휴원일(3차 리뷰 재현): 월 → 화, 적용일 월 11/2, 월 11/9 휴원 — 화 11/10이 비는 회차 · 새 요일만 휴원이면 막는다", () => {
    const hol = { "2026-11-09": "휴원" };
    expect(carryGapDates({ toDay: "tue", days: 1, effective: "2026-11-02", until: null, horizon: "2026-11-30", holidays: hol }).gaps).toEqual([
      "2026-11-10",
    ]);
    expect(agree([{ day: "mon", start: "17:20" }], [{ day: "tue", start: "17:20" }], "2026-11-02", { holidays: ["2026-11-09"] })).toBe("passed");
    const toHol = carryGapDates({ toDay: "tue", days: 1, effective: "2026-11-02", until: null, horizon: "2026-11-30", holidays: { "2026-11-10": "휴원" } });
    expect(toHol.onHoliday).toEqual(["2026-11-10"]);
    // 마지막 계획 줄이 휴원일 앞이면 맞출 줄이 없다 — 막지 않는다.
    expect(carryGapDates({ toDay: "tue", days: 1, effective: "2026-11-02", until: null, horizon: "2026-11-05", holidays: { "2026-11-10": "휴원" } }).onHoliday).toEqual([]);
  });

  it("🔴 휴원일 전수(한 요일 블록 · 모든 요일 쌍 × 적용일 7가지 × 휴원일 하나) — 통과한 이동은 어긋남 0", () => {
    const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat"];
    let passed = 0;
    for (let e = 0; e < 7; e++) {
      const effective = shiftYmd("2026-11-02", e);
      for (let h = 0; h < 5; h++) {
        const holidays = [shiftYmd("2026-11-16", h * 3)];
        for (const a of DAYS) {
          for (const b of DAYS) {
            if (a !== b && agree([{ day: a, start: "17:20" }], [{ day: b, start: "17:20" }], effective, { holidays }) === "passed") passed += 1;
          }
        }
      }
    }
    expect(passed).toBeGreaterThan(500); // 막힘은 새 요일만 휴원인 경우뿐
  });

  it("🔴 배정 시작일이 옛·새 날짜 사이(3차 리뷰 재현) — 목 → 월(적용일 월 11/2, 시작 목 11/12) · 화 → 수(시작 수 11/11)는 막는다", () => {
    expect(agree([{ day: "thu", start: "17:20" }], [{ day: "mon", start: "17:20" }], "2026-11-02", { start: "2026-11-12" })).toBe("blocked");
    expect(agree([{ day: "tue", start: "17:20" }], [{ day: "wed", start: "17:20" }], "2026-11-04", { start: "2026-11-11" })).toBe("blocked");
    // 시작일이 사이에 안 끼면(화 11/17 시작 — 옛 화 11/17 → 새 수 11/18 둘 다 시작일 이후) 통과하고 맞는다.
    expect(agree([{ day: "tue", start: "17:20" }], [{ day: "wed", start: "17:20" }], "2026-11-04", { start: "2026-11-17" })).toBe("passed");
  });

  it("휴원일과 배정 시작일이 함께 — 통과한 이동은 어긋남 0(재검토 2026-10-28)", () => {
    const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat"];
    let passed = 0;
    for (let k = 1; k <= 7; k++) {
      for (const a of DAYS) {
        for (const b of DAYS) {
          const start = shiftYmd("2026-11-09", k);
          if (a !== b && agree([{ day: a, start: "17:20" }], [{ day: b, start: "17:20" }], "2026-11-04", { start, holidays: [shiftYmd(start, -2), shiftYmd(start, 5)] }) === "passed") passed += 1;
        }
      }
    }
    expect(passed).toBeGreaterThan(50);
  });

  it("🔴 배정 시작일 전수(모든 요일 쌍 × 적용일 7가지 × 시작일 7가지) — 통과한 이동은 어긋남 0", () => {
    const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat"];
    let passed = 0;
    for (let e = 0; e < 7; e++) {
      const effective = shiftYmd("2026-11-02", e);
      for (let k = 1; k <= 7; k++) {
        for (const a of DAYS) {
          for (const b of DAYS) {
            if (a !== b && agree([{ day: a, start: "17:20" }], [{ day: b, start: "17:20" }], effective, { start: shiftYmd("2026-11-09", k) }) === "passed") passed += 1;
          }
        }
      }
    }
    expect(passed).toBeGreaterThan(500);
  });
});

describe("하루 단위 배정(dayPaceKeepsDays) — 하루끼리 묶여 가나(3차 리뷰 2026-10-28)", () => {
  it("같은 날 두 교시 중 하나만 다른 요일 · 두 요일을 한 요일로 = 거짓 · 요일째 옮기면 참", () => {
    expect(dayPaceKeepsDays([{ fromDay: "mon", toDay: "mon" }, { fromDay: "mon", toDay: "tue" }])).toBe(false);
    expect(dayPaceKeepsDays([{ fromDay: "mon", toDay: "wed" }, { fromDay: "tue", toDay: "wed" }])).toBe(false);
    expect(dayPaceKeepsDays([{ fromDay: "mon", toDay: "tue" }, { fromDay: "mon", toDay: "tue" }, { fromDay: "tue", toDay: "wed" }])).toBe(true);
    expect(dayPaceKeepsDays([])).toBe(true);
  });

  it("taken 안내: 같은 배정이 도착 칸을 다른 자리 번호로 골랐으면 그 말을 한다(3차 리뷰 2026-10-28)", () => {
    const r = carrySlotPicks({
      plans: [{ id: "a", textbookId: "t1", startDate: "2026-09-01", picks: ["tue|17:20|1", "tue|17:20|2", "wed|17:20|1"] }],
      moves: [{ fromDay: "tue", fromStart: "17:20", toDay: "wed", toStart: "17:20" }],
      schedules: [],
      effective: "2026-11-04",
    });
    expect(r.conflicts).toEqual([{ planId: "a", textbookId: "t1", kind: "taken", cell: "wed|17:20", mixed: true }]);
    expect(picksConflictText(r.conflicts, () => "Reading")).toContain("다른 자리 번호로 이미 골라 두어");
  });
});
