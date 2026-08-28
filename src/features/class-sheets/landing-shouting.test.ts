import { describe, expect, it } from "vitest";
import { shoutingCountOf, summarizeShouting } from "./landing-shouting";

describe("shoutingCountOf", () => {
  it("EiE가 아닌 반은 null — 0이 아니다(0/6은 '해야 하는데 안 했다'는 거짓말)", () => {
    expect(shoutingCountOf({ totalSlots: 6, shoutingSlots: null })).toBeNull();
  });

  it("분모를 넘는 체크는 잘라낸다 — 화면에 7/6이 뜨지 않게", () => {
    expect(shoutingCountOf({ totalSlots: 6, shoutingSlots: 7 })).toBe(6);
  });

  it("음수는 0으로", () => {
    expect(shoutingCountOf({ totalSlots: 6, shoutingSlots: -1 })).toBe(0);
  });

  it("이 주 수업이 없는 반은 0/0", () => {
    expect(shoutingCountOf({ totalSlots: 0, shoutingSlots: 0 })).toBe(0);
  });
});

describe("summarizeShouting", () => {
  it("EiE 반만 분자·분모에 들어간다", () => {
    const s = summarizeShouting([
      { totalSlots: 6, shoutingSlots: 3 }, // EiE
      { totalSlots: 6, shoutingSlots: 6 }, // EiE
      { totalSlots: 6, shoutingSlots: null }, // 인재원 영어 — 통째로 빠진다
    ]);
    expect(s).toEqual({ classes: 2, scheduled: 12, checked: 9, pct: 75 });
  });

  it("EiE 반이 없으면 전부 0 — 화면은 이걸 보고 머리 항목을 안 낸다", () => {
    expect(summarizeShouting([{ totalSlots: 6, shoutingSlots: null }])).toEqual({
      classes: 0,
      scheduled: 0,
      checked: 0,
      pct: 0,
    });
  });

  it("이 주 수업이 없는 EiE 반은 반 수에는 들어가되 0으로 나누지 않는다", () => {
    expect(summarizeShouting([{ totalSlots: 0, shoutingSlots: 0 }])).toEqual({
      classes: 1,
      scheduled: 0,
      checked: 0,
      pct: 0,
    });
  });

  it("빈 목록", () => {
    expect(summarizeShouting([])).toEqual({ classes: 0, scheduled: 0, checked: 0, pct: 0 });
  });
});
