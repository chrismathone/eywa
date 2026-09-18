import { describe, expect, it } from "vitest";
import { isMissingUsedOnColumn } from "./missing-used-on";

describe("사용일 컬럼(0270a) 미적용 판정", () => {
  it("조회 실패(42703)와 쓰기 실패(PGRST204)를 둘 다 알아본다", () => {
    expect(
      isMissingUsedOnColumn({
        code: "42703",
        message: "column leave_adjustments.used_on does not exist",
      }),
    ).toBe(true);
    expect(
      isMissingUsedOnColumn({
        code: "PGRST204",
        message: "Could not find the 'used_on' column of 'leave_adjustments' in the schema cache",
      }),
    ).toBe(true);
    expect(isMissingUsedOnColumn(new Error("column used_on does not exist"))).toBe(true);
  });

  it("🔴 다른 컬럼의 같은 오류를 사용일 문제로 오진하지 않는다", () => {
    expect(
      isMissingUsedOnColumn({ code: "42703", message: "column leave_adjustments.usedon does not exist" }),
    ).toBe(false);
    expect(isMissingUsedOnColumn({ code: "42703", message: 'column "reasons" does not exist' })).toBe(false);
  });

  it("🔴 표 없음·권한 오류를 컬럼 없음으로 읽지 않는다(폴백이 진짜 실패를 삼키지 않게)", () => {
    expect(
      isMissingUsedOnColumn({ code: "42P01", message: 'relation "public.leave_adjustments" does not exist' }),
    ).toBe(false);
    expect(isMissingUsedOnColumn({ code: "42501", message: "permission denied for table leave_adjustments" })).toBe(
      false,
    );
  });

  it("빈 값·모양이 다른 오류는 false(모르면 폴백하지 않는다)", () => {
    expect(isMissingUsedOnColumn(null)).toBe(false);
    expect(isMissingUsedOnColumn(undefined)).toBe(false);
    expect(isMissingUsedOnColumn({})).toBe(false);
    expect(isMissingUsedOnColumn("used_on")).toBe(false); // 이름만 있고 오류 신호가 없다
  });
});
