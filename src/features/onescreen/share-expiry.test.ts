import { describe, expect, it } from "vitest";
import { isShareExpired, shareExpiryDate } from "./share-expiry";

describe("shareExpiryDate — report_date + 90일(UTC 산술)", () => {
  it("일반 케이스", () => {
    expect(shareExpiryDate("2026-01-01")).toBe("2026-04-01"); // 1월(31)+2월(28)+3월(31)=90
  });
  it("월 롤오버", () => {
    expect(shareExpiryDate("2026-06-08")).toBe("2026-09-06");
  });
  it("연 롤오버", () => {
    expect(shareExpiryDate("2025-12-15")).toBe("2026-03-15");
  });
  it("윤년 2월 포함", () => {
    // 2024는 윤년(2월 29일). 2024-01-01 + 90일 = 2024-03-31.
    expect(shareExpiryDate("2024-01-01")).toBe("2024-03-31");
  });
  it("days 파라미터 조정 가능", () => {
    expect(shareExpiryDate("2026-01-01", 1)).toBe("2026-01-02");
  });
});

describe("isShareExpired — 90일째 유효, 다음날부터 만료", () => {
  const reportDate = "2026-01-01";
  const expiry = "2026-04-01"; // +90일

  it("89일째(만료 전) → 유효", () => {
    expect(isShareExpired(reportDate, "2026-03-31")).toBe(false);
  });
  it("90일째 당일(=expiry) → 유효(경계 포함)", () => {
    expect(isShareExpired(reportDate, expiry)).toBe(false);
  });
  it("91일째(expiry 다음날) → 만료", () => {
    expect(isShareExpired(reportDate, "2026-04-02")).toBe(true);
  });
  it("한참 지난 뒤 → 만료", () => {
    expect(isShareExpired(reportDate, "2026-12-31")).toBe(true);
  });
  it("보고일 당일 → 유효", () => {
    expect(isShareExpired(reportDate, reportDate)).toBe(false);
  });
  it("빈 report_date → 만료 아님(방어)", () => {
    expect(isShareExpired("", "2030-01-01")).toBe(false);
  });
});
