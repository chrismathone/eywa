import { describe, expect, it } from "vitest";
import {
  applySeatPeriodChoices,
  resolveSeatPeriodChoices,
  seatChoiceKey,
  seatShowsAtPeriod,
  shouldAskSeatPin,
  validateSeatPeriodMove,
  SEAT_PERIOD_NO_SLOT,
  SEAT_PERIOD_ONE_SLOT,
  SEAT_PERIOD_SAME_CLASS_ONLY,
} from "./period-choice";

const JP1 = ["14:20", "16:20"];

describe("그 날짜에 유효한 선택", () => {
  it("고정은 시작일 이후에만 적용된다 — 과거 화면은 기록 그대로", () => {
    const pins = [{ classId: "JP1", studentId: "a", slotStart: "16:20", effectiveFrom: "2026-09-10" }];
    expect(resolveSeatPeriodChoices({ moves: [], pins, date: "2026-09-03" })).toEqual({});
    expect(resolveSeatPeriodChoices({ moves: [], pins, date: "2026-09-10" })).toEqual({
      "JP1|a": "16:20",
    });
    expect(resolveSeatPeriodChoices({ moves: [], pins, date: "2026-09-17" })).toEqual({
      "JP1|a": "16:20",
    });
  });

  it("하루짜리가 고정을 이긴다 — 오늘만 옮긴 것이 되튀지 않게", () => {
    const out = resolveSeatPeriodChoices({
      moves: [{ classId: "JP1", studentId: "a", slotStart: "14:20" }],
      pins: [{ classId: "JP1", studentId: "a", slotStart: "16:20", effectiveFrom: "2026-01-01" }],
      date: "2026-09-10",
    });
    expect(out[seatChoiceKey("JP1", "a")]).toBe("14:20");
  });
});

describe("이 교시에 서는가", () => {
  const base = { classSlots: JP1, markedSlots: [] as string[] };

  it("선택이 없으면 지금까지 그대로 — 모든 교시에 선다", () => {
    expect(seatShowsAtPeriod({ ...base, chosen: null, slotStart: "14:20" })).toBe(true);
    expect(seatShowsAtPeriod({ ...base, chosen: undefined, slotStart: "16:20" })).toBe(true);
  });

  it("고른 교시에만 선다", () => {
    expect(seatShowsAtPeriod({ ...base, chosen: "16:20", slotStart: "16:20" })).toBe(true);
    expect(seatShowsAtPeriod({ ...base, chosen: "16:20", slotStart: "14:20" })).toBe(false);
  });

  it("🔴 사실이 규칙을 이긴다 — 이미 기록이 있는 교시에서는 안 감춘다", () => {
    expect(
      seatShowsAtPeriod({ ...base, chosen: "16:20", slotStart: "14:20", markedSlots: ["14:20"] }),
    ).toBe(true);
  });

  it("🔴 고른 교시가 그 날 없으면 선택을 버린다 — 시간표가 바뀌어도 사람이 안 사라진다", () => {
    expect(seatShowsAtPeriod({ ...base, chosen: "18:20", slotStart: "14:20" })).toBe(true);
    expect(seatShowsAtPeriod({ ...base, chosen: "18:20", slotStart: "16:20" })).toBe(true);
  });

  it("자리 교시가 하나뿐이면 감출 것이 없다", () => {
    expect(seatShowsAtPeriod({ chosen: "14:20", slotStart: "14:20", classSlots: ["14:20"], markedSlots: [] })).toBe(
      true,
    );
  });
});

describe("명단에서 빼기", () => {
  const rosters = [
    { classId: "JP1", students: [{ id: "a" }, { id: "b" }] },
    { classId: "LT6", students: [{ id: "c" }] },
  ];
  const opts = {
    choices: { "JP1|a": "16:20" },
    slotsByClass: { JP1, LT6: ["16:20", "18:20"] },
    markedSlotsByCell: {},
  };

  it("14:20에서는 a가 빠지고 16:20에서는 남는다", () => {
    expect(applySeatPeriodChoices(rosters, { ...opts, slotStart: "14:20" })[0]!.students).toEqual([
      { id: "b" },
    ]);
    expect(applySeatPeriodChoices(rosters, { ...opts, slotStart: "16:20" })[0]!.students).toEqual([
      { id: "a" },
      { id: "b" },
    ]);
  });

  it("전원이 빠져도 반 묶음은 남는다 — 반이 사라지면 '수업이 없어졌나'가 된다", () => {
    const out = applySeatPeriodChoices(rosters, {
      ...opts,
      slotStart: "14:20",
      choices: { "JP1|a": "16:20", "JP1|b": "16:20" },
    });
    expect(out).toHaveLength(2);
    expect(out[0]!.students).toEqual([]);
  });

  it("다른 반은 그대로다", () => {
    expect(applySeatPeriodChoices(rosters, { ...opts, slotStart: "14:20" })[1]!.students).toEqual([
      { id: "c" },
    ]);
  });
});

describe("교시 이동 판정", () => {
  const base = {
    classId: "JP1",
    toClassId: "JP1",
    fromSlot: "14:20",
    toSlot: "16:20",
    classSlots: JP1,
    markedReason: null as string | null,
  };

  it("같은 반의 다른 교시로만 옮긴다", () => {
    expect(validateSeatPeriodMove(base)).toEqual({ ok: true });
    expect(validateSeatPeriodMove({ ...base, toClassId: "LT6" })).toEqual({
      error: SEAT_PERIOD_SAME_CLASS_ONLY,
    });
  });

  it("그 반이 없는 교시로는 못 옮긴다", () => {
    expect(validateSeatPeriodMove({ ...base, toSlot: "15:00" })).toEqual({ error: SEAT_PERIOD_NO_SLOT });
  });

  it("하루 한 번뿐인 반은 애초에 고를 것이 없다", () => {
    expect(validateSeatPeriodMove({ ...base, classSlots: ["14:20"] })).toEqual({
      error: SEAT_PERIOD_ONE_SLOT,
    });
  });

  it("🔴 출결이 찍힌 카드는 여기서도 막힌다", () => {
    expect(validateSeatPeriodMove({ ...base, markedReason: "출결이 찍힘" })).toEqual({
      error: "출결이 찍힘",
    });
  });

  it("이미 그 교시면 아무 일도 아니다", () => {
    expect(validateSeatPeriodMove({ ...base, toSlot: "14:20" })).toEqual({ error: "이미 그 교시에 있습니다" });
  });
});

describe("고정을 물을 것인가", () => {
  it("이미 같은 교시로 고정돼 있으면 안 묻는다", () => {
    expect(shouldAskSeatPin({ pinnedSlot: "16:20", toSlot: "16:20" })).toBe(false);
    expect(shouldAskSeatPin({ pinnedSlot: "14:20", toSlot: "16:20" })).toBe(true);
    expect(shouldAskSeatPin({ pinnedSlot: null, toSlot: "16:20" })).toBe(true);
  });
});
