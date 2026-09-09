import { describe, expect, it } from "vitest";

import { freezeMoveDate, isScheduledMove, resolveApplyDate, shortMoveDate } from "./move-date";

describe("resolveApplyDate", () => {
  it("건별 날짜가 툴바·앵커를 이긴다", () => {
    expect(resolveApplyDate("2026-09-20", "2026-09-15", "2026-09-14")).toBe("2026-09-20");
  });
  it("건별이 없으면 툴바, 툴바도 없으면 앵커", () => {
    expect(resolveApplyDate(null, "2026-09-15", "2026-09-14")).toBe("2026-09-15");
    expect(resolveApplyDate(null, null, "2026-09-14")).toBe("2026-09-14");
  });
  it("셋 다 없으면 즉시(null)", () => {
    expect(resolveApplyDate(null, null, null)).toBeNull();
    expect(resolveApplyDate(undefined, undefined, undefined)).toBeNull();
  });
});

describe("isScheduledMove", () => {
  it("오늘보다 뒤여야 예약", () => {
    expect(isScheduledMove("2026-09-10", "2026-09-09")).toBe(true);
    expect(isScheduledMove("2026-09-09", "2026-09-09")).toBe(false);
    expect(isScheduledMove("2026-09-08", "2026-09-09")).toBe(false);
  });
  it("즉시(null)는 예약이 아니다", () => {
    expect(isScheduledMove(null, "2026-09-09")).toBe(false);
  });
});

describe("freezeMoveDate", () => {
  it("기본값과 같으면 얼리지 않는다(즉시 의도 보존)", () => {
    expect(freezeMoveDate("2026-09-09", "2026-09-09")).toBeNull();
  });
  it("다르면 그 날짜로 얼린다", () => {
    expect(freezeMoveDate("2026-09-20", "2026-09-09")).toBe("2026-09-20");
  });
  it("형식이 아니면 null", () => {
    expect(freezeMoveDate("", "2026-09-09")).toBeNull();
    expect(freezeMoveDate("2026-9-9", "2026-09-09")).toBeNull();
  });
});

describe("shortMoveDate", () => {
  it("앞 0을 뗀 월/일", () => {
    expect(shortMoveDate("2026-09-05")).toBe("9/5");
    expect(shortMoveDate("2026-12-25")).toBe("12/25");
  });
  it("빈 값은 빈 문자열", () => {
    expect(shortMoveDate(null)).toBe("");
  });
});
