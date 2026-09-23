import { describe, expect, it } from "vitest";
import { ilikeTerm, inMeetingRange, matchMeetingStatus, matchMeetingText } from "./list-filter";

describe("meetings list filter", () => {
  const now = new Date("2026-09-23T03:00:00Z");
  it("기간", () => {
    expect(inMeetingRange("2026-09-20T00:00:00Z", "7d", now)).toBe(true);
    expect(inMeetingRange("2026-09-01T00:00:00Z", "7d", now)).toBe(false);
    expect(inMeetingRange("2026-09-01T00:00:00Z", "month", now)).toBe(true);
    expect(inMeetingRange("2026-08-31T14:00:00Z", "month", now)).toBe(false); // KST 8/31 23시
    expect(inMeetingRange("2020-01-01T00:00:00Z", "all", now)).toBe(true);
  });
  it("상태", () => {
    expect(matchMeetingStatus("analyzing", "processing")).toBe(true);
    expect(matchMeetingStatus("completed", "processing")).toBe(false);
  });
  it("검색은 AI 요약까지", () => {
    const m = { title: "주간 회의", attendees: ["박소선"], aiSummary: "셔틀 노선 변경 결정" };
    expect(matchMeetingText(m, "셔틀")).toBe(true);
    expect(matchMeetingText(m, "박소")).toBe(true);
    expect(matchMeetingText(m, "없음")).toBe(false);
    expect(matchMeetingText(m, "  ")).toBe(true);
  });
  it("ilike 검색어는 패턴 문법을 지운다", () => {
    expect(ilikeTerm("50%_할인,(a)")).toBe("50  할인  a");
    expect(ilikeTerm("  ")).toBe("");
  });
});
