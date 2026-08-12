import { describe, expect, it } from "vitest";
import {
  TODAY_GUTTER,
  TODAY_NAME_W,
  TODAY_NOTE_W,
  TODAY_PLAN_W,
  TODAY_SLOT_COLS,
  TODAY_SLOT_W,
  todayContentWidth,
  todaySlotOffset,
} from "./today-columns";

const FIXED = TODAY_SLOT_COLS.reduce((a, b) => a + b, 0);

describe("오늘 면 가로 치수 — 위 카드 레일과 아래 표가 같은 격자", () => {
  it("교시 폭 = 카드 + 숨", () => {
    expect(TODAY_SLOT_W).toBe(TODAY_PLAN_W + TODAY_GUTTER);
  });

  it("🔴 표의 한 교시 열들을 더하면 카드 한 칸과 같다(이게 어긋나면 줄이 안 맞는다)", () => {
    expect(FIXED + TODAY_NOTE_W).toBe(TODAY_SLOT_W);
  });

  it("특이사항이 슬리버가 되지 않는다 — 고정 열을 늘리면 여기서 걸린다", () => {
    expect(TODAY_NOTE_W).toBeGreaterThanOrEqual(200);
  });

  it("k번째 교시 시작점 = 학생 열 + k×교시 폭 (위아래 같은 식)", () => {
    expect(todaySlotOffset(0)).toBe(TODAY_NAME_W);
    expect(todaySlotOffset(1)).toBe(TODAY_NAME_W + TODAY_SLOT_W);
    expect(todaySlotOffset(3)).toBe(TODAY_NAME_W + 3 * TODAY_SLOT_W);
  });

  it("총 폭 = 마지막 교시의 끝 — 레일과 표가 같은 길이로 끝난다", () => {
    for (const n of [1, 2, 3, 5, 8]) {
      expect(todayContentWidth(n)).toBe(todaySlotOffset(n - 1) + TODAY_SLOT_W);
    }
  });

  it("교시가 없으면 학생 열만", () => {
    expect(todayContentWidth(0)).toBe(TODAY_NAME_W);
    expect(todayContentWidth(-3)).toBe(TODAY_NAME_W);
  });
});
