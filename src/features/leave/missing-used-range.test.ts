import { describe, expect, it } from "vitest";
import { isMissingUsedRangeColumn } from "./missing-used-range";

describe("사용 기간 칸(0270b) 미적용 판정", () => {
  it("조회 실패(42703)와 쓰기 실패(PGRST204)를 둘 다 알아본다", () => {
    expect(
      isMissingUsedRangeColumn({
        code: "42703",
        message: "column leave_adjustments.used_start does not exist",
      }),
    ).toBe(true);
    expect(
      isMissingUsedRangeColumn({
        code: "PGRST204",
        message: "Could not find the 'used_end' column of 'leave_adjustments' in the schema cache",
      }),
    ).toBe(true);
  });

  it("옛 이름(used_on)도 같은 폴백 — 0270a만 적용된 DB와 옛 앱이 남은 창 둘 다 산다", () => {
    expect(isMissingUsedRangeColumn(new Error("column used_on does not exist"))).toBe(true);
  });

  it("🔴 다른 컬럼의 같은 오류를 사용 기간 문제로 오진하지 않는다", () => {
    expect(
      isMissingUsedRangeColumn({ code: "42703", message: "column leave_adjustments.usedstart does not exist" }),
    ).toBe(false);
    expect(isMissingUsedRangeColumn({ code: "42703", message: 'column "reasons" does not exist' })).toBe(false);
  });

  it("🔴 표 없음·권한 오류를 칸 없음으로 읽지 않는다(폴백이 진짜 실패를 삼키지 않게)", () => {
    expect(
      isMissingUsedRangeColumn({
        code: "42P01",
        message: 'relation "public.leave_adjustments" does not exist',
      }),
    ).toBe(false);
    expect(
      isMissingUsedRangeColumn({ code: "42501", message: "permission denied for table leave_adjustments" }),
    ).toBe(false);
  });

  it("빈 값·모양이 다른 오류는 false(모르면 폴백하지 않는다)", () => {
    expect(isMissingUsedRangeColumn(null)).toBe(false);
    expect(isMissingUsedRangeColumn(undefined)).toBe(false);
    expect(isMissingUsedRangeColumn({})).toBe(false);
    expect(isMissingUsedRangeColumn("used_start")).toBe(false); // 이름만 있고 오류 신호가 없다
  });
});
