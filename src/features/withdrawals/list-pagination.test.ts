import { describe, expect, it } from "vitest";
import { fitWithdrawalRows, withdrawalPage, withdrawalPageSize } from "./list-pagination";

describe("퇴원 목록 페이지", () => {
  it("우측 카드 높이에서 제목과 페이지 바를 뺀 만큼만 행을 배치한다", () => {
    expect(fitWithdrawalRows(540, 145, 45)).toBe(8);
    expect(fitWithdrawalRows(400, 145, 45)).toBe(5);
    expect(fitWithdrawalRows(100, 145, 45)).toBe(1);
    expect(fitWithdrawalRows(10000, 145, 45)).toBe(50);
    expect(fitWithdrawalRows(0, 0, 0)).toBe(8);
  });
  it("URL의 잘못된 크기와 페이지를 유효 범위로 제한한다", () => {
    for (const value of [undefined, "no", "0", "-2", "Infinity"]) expect(withdrawalPageSize(value)).toBe(8);
    expect(withdrawalPageSize("1000")).toBe(50);
    expect(withdrawalPageSize("3.7")).toBe(3);
    expect(withdrawalPage("999", 19, 8)).toEqual({ page: 3, totalPages: 3, start: 16, end: 19 });
    expect(withdrawalPage("-1", 19, 8)).toEqual({ page: 1, totalPages: 3, start: 0, end: 8 });
    expect(withdrawalPage("2", 0, 8)).toEqual({ page: 1, totalPages: 1, start: 0, end: 0 });
  });
});
