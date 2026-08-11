import { describe, expect, it } from "vitest";
import { landingCardPct, summarizeLanding } from "./landing-summary";

const card = (totalSlots: number, filledSlots: number) => ({ totalSlots, filledSlots });

describe("summarizeLanding", () => {
  it("빈 목록은 전부 0 — 0으로 나누지 않는다", () => {
    expect(summarizeLanding([])).toEqual({
      classes: 0,
      scheduled: 0,
      filled: 0,
      pct: 0,
      untouched: 0,
      done: 0,
      idle: 0,
    });
  });

  it("배정·작성 합과 백분율(반올림)", () => {
    const s = summarizeLanding([card(6, 2), card(6, 0), card(5, 5)]);
    expect(s.classes).toBe(3);
    expect(s.scheduled).toBe(17);
    expect(s.filled).toBe(7);
    expect(s.pct).toBe(41); // 7/17 = 41.2%
  });

  it("배정 0인 반은 '미작성'이 아니라 idle — 분모에도 안 들어간다", () => {
    const s = summarizeLanding([card(0, 0), card(4, 4)]);
    expect(s.idle).toBe(1);
    expect(s.untouched).toBe(0);
    expect(s.done).toBe(1);
    expect(s.scheduled).toBe(4);
    expect(s.pct).toBe(100);
  });

  it("한 칸도 안 쓴 반 / 전부 쓴 반을 갈라 센다", () => {
    const s = summarizeLanding([card(6, 0), card(6, 3), card(6, 6)]);
    expect(s.untouched).toBe(1);
    expect(s.done).toBe(1);
  });

  it("분자가 분모를 넘거나 음수여도 %는 0~100에 갇힌다", () => {
    expect(summarizeLanding([card(4, 9)]).pct).toBe(100);
    expect(summarizeLanding([card(4, 9)]).filled).toBe(4);
    expect(summarizeLanding([card(4, -3)]).pct).toBe(0);
    expect(summarizeLanding([card(4, -3)]).untouched).toBe(1);
  });
});

describe("landingCardPct", () => {
  it("배정 0이면 0 (막대 자리는 남기되 채우지 않는다)", () => {
    expect(landingCardPct(card(0, 0))).toBe(0);
    expect(landingCardPct(card(0, 3))).toBe(0);
  });

  it("반올림 + 0~100 클램프", () => {
    expect(landingCardPct(card(6, 2))).toBe(33);
    expect(landingCardPct(card(6, 6))).toBe(100);
    expect(landingCardPct(card(6, 99))).toBe(100);
    expect(landingCardPct(card(6, -1))).toBe(0);
  });
});
