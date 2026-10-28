import { describe, expect, it } from "vitest";
import {
  carryConflicts,
  carryConflictText,
  carryGroups,
  carryOffset,
  carryRounds,
  carrySummary,
  mondayOf,
  parseSlotMemoKey,
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

  it("안내 글은 무엇이 어느 날인지와 덮어쓰지 않았다는 것을 말한다", () => {
    const text = carryConflictText([
      { label: "수업 계획", kind: "occupied", dates: ["2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30"] },
      { label: "학생 기록", kind: "merge", dates: ["2026-11-09"] },
    ]);
    expect(text).toContain("옮겨 갈 교시에 이미 기록이 있습니다(수업 계획 11/9·11/16·11/23 외 1일)");
    expect(text).toContain("두 교시의 기록이 한 교시로 겹칩니다(학생 기록 11/9)");
    expect(text).toContain("덮어쓰거나 버리지 않으려고");
    expect(text).not.toContain("배치가 끝나는 날");
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
    expect(groups[0]).toMatchObject({ fromDate: "2026-11-05", fromSlot: "16:00:00", toSlot: "17:00:00" });
  });

  it("요약 — 표마다 건수 · 한 주 밀림을 알린다 · 없으면 null", () => {
    const items = [item({ id: "a" }), item({ id: "b" }), item({ id: "m", table: "class_sheet_student_marks", label: "학생 기록" })];
    expect(carrySummary(items, false)).toBe("함께 옮긴 기록: 수업 계획 2건 · 학생 기록 1건");
    expect(carrySummary(items, true)).toContain("한 주 뒤 같은 요일로");
    expect(carrySummary([], true)).toBeNull();
  });
});
