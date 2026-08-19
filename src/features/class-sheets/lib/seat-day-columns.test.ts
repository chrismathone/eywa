import { describe, expect, it } from "vitest";
import { rosterTextCols } from "./roster-form";
import { TODAY_BASE_COLS } from "./today-columns";
import {
  SEAT_BADGE_W,
  SEAT_NAME_GAP,
  SEAT_NAME_PAD,
  SEAT_NAME_TEXT_W,
  SEAT_NAME_W,
  SEAT_NOTE_MIN_W,
  seatFixedCols,
  seatLeadCols,
  seatTableMinWidth,
} from "./seat-day-columns";

describe("305·JJ 하루 표 열 폭", () => {
  it("이름 열 = 이름 몫 + 사이 + 배지 + 여백 — 배지가 이름을 밀어낼 수 없다", () => {
    // 이 항등식이 깨지면 이름+배지가 한 줄에 안 들어가 배지가 둘째 줄로 꺾이고,
    // 그 행만 키가 커져 옆 열 입력 상자가 위아래로 어긋난다(2026-08-19 원장 제보의 원인).
    expect(SEAT_NAME_W).toBe(SEAT_NAME_TEXT_W + SEAT_NAME_GAP + SEAT_BADGE_W + SEAT_NAME_PAD);
    // 이름 몫 하한: 13px 굵게 한글 5자(≈65) + 동명이인 접미 1자(≈9).
    expect(SEAT_NAME_TEXT_W).toBeGreaterThanOrEqual(74);
    // 배지 몫 하한: 10px 굵게 `초등 브릿지 A`(≈76, px-1.5 포함).
    expect(SEAT_BADGE_W).toBeGreaterThanOrEqual(76);
  });

  it("앞 4열(이름·출결·유닛·태도)은 폼과 무관하게 같다 — 블록이 여러 개여도 같은 x", () => {
    expect(seatLeadCols()).toEqual([SEAT_NAME_W, ...TODAY_BASE_COLS]);
    expect(seatFixedCols("default").slice(0, 4)).toEqual(seatLeadCols());
    expect(seatFixedCols("selfStudy").slice(0, 4)).toEqual(seatLeadCols());
  });

  it("폼 차이는 **자유 입력 열에서만** 난다(JJ = 듣기 레벨·누적 암기 단어수)", () => {
    for (const form of ["default", "selfStudy"] as const) {
      expect(seatFixedCols(form).slice(4)).toEqual(rosterTextCols(form).map((c) => c.width));
    }
    expect(seatFixedCols("selfStudy").length).toBe(seatFixedCols("default").length + 1);
  });

  it("표 최소 폭 = 고정 열 합 + 특이사항 최소(좁은 창에서 특이사항이 0으로 짜부라지지 않게)", () => {
    for (const form of ["default", "selfStudy"] as const) {
      const fixed = seatFixedCols(form).reduce((a, b) => a + b, 0);
      expect(seatTableMinWidth(form)).toBe(fixed + SEAT_NOTE_MIN_W);
      expect(seatTableMinWidth(form)).toBeGreaterThan(fixed);
    }
  });
});
