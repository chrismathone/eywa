import { describe, expect, it } from "vitest";
import {
  TODAY_BASE_COLS,
  TODAY_GUTTER,
  TODAY_NAME_W,
  TODAY_PLAN_W,
  TODAY_SLOT_W,
  todayContentWidth,
  todayNoteWidth,
  todaySlotCols,
  todaySlotOffset,
} from "./today-columns";
import { ROSTER_TEXT_COLS, type RosterForm } from "./roster-form";

const FORMS: RosterForm[] = ["default", "selfStudy"];

describe("오늘 면 가로 치수 — 위 카드 레일과 아래 표가 같은 격자", () => {
  it("교시 폭 = 카드 + 숨", () => {
    expect(TODAY_SLOT_W).toBe(TODAY_PLAN_W + TODAY_GUTTER);
  });

  it.each(FORMS)(
    "🔴 [%s] 표의 한 교시 열들을 더하면 카드 한 칸과 같다(이게 어긋나면 줄이 안 맞는다)",
    (form) => {
      expect(todaySlotCols(form).reduce((a, b) => a + b, 0)).toBe(TODAY_SLOT_W);
    },
  );

  it.each(FORMS)("[%s] 열 구성 = 출결·유닛·태도 + 자유 입력 + 특이사항", (form) => {
    const cols = todaySlotCols(form);
    expect(cols).toHaveLength(TODAY_BASE_COLS.length + ROSTER_TEXT_COLS[form].length + 1);
    expect(cols.slice(0, 3)).toEqual([...TODAY_BASE_COLS]);
    expect(cols[cols.length - 1]).toBe(todayNoteWidth(form));
  });

  it.each(FORMS)("[%s] 특이사항이 슬리버가 되지 않는다 — 고정 열을 늘리면 여기서 걸린다", (form) => {
    expect(todayNoteWidth(form)).toBeGreaterThanOrEqual(200);
  });

  it("JJ 폼은 칸이 하나 더 많고 그만큼 특이사항이 줄어든다(원장 2026-08-13)", () => {
    expect(todayNoteWidth("selfStudy")).toBeLessThan(todayNoteWidth("default"));
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
