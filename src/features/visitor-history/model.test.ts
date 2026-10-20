import { describe, expect, it } from "vitest";
import { classify, comparison, counts, displayTitle, mergeMonth, reconcileMonths, reservation, safeCalendarUrl, type CalendarEvent, type SourceResult } from "./model";
const event = (extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: "sample", summary: "수학입테 가상학생", start: { dateTime: "2026-01-04T07:00:00Z" }, ...extra,
});
const source = (events: CalendarEvent[], extra: Partial<SourceResult> = {}): SourceResult => ({
  source: "입학 상담", complete: true, scanned: events.length, unclassified: 0,
  records: events.flatMap(e => { const r = reservation(e, "입학 상담", "a", "2026-01"); return r ? [r] : []; }), ...extra,
});
describe("reservation evidence", () => {
  it.each(["수학입테 가상학생", "영어 입학 테스트", "입 학 테 스 트 상담"])("classifies %s once", title =>
    expect(classify(title)?.category).toBe("entrance"));
  it.each(["레벨테스트", "레테", "테스트 상담"])("classifies %s as test", title =>
    expect(classify(title)?.category).toBe("test"));
  it("excludes unrelated titles without using descriptions", () => expect(classify("직원 식사")).toBeNull());
  it.each(["학부모상담", "재원생 상담", "입테 일정변경", "전화상담", "테스트 문자 발송", "월말테스트"])("holds %s for review", title =>
    expect(reservation(event({ summary: title }), "입학 상담", "a", "2026-01")?.status).toBe("review"));
  it.each(["취소 입테", "테스트 취 소"])("excludes %s", title =>
    expect(reservation(event({ summary: title }), "입학 상담", "a", "2026-01")?.status).toBe("cancelled"));
  it("honors deleted and tentative status", () => {
    expect(reservation(event({ status: "cancelled" }), "입학 상담", "a", "2026-01")?.status).toBe("cancelled");
    expect(reservation(event({ status: "tentative" }), "입학 상담", "a", "2026-01")?.status).toBe("review");
  });
  it("uses KST month boundaries, including UTC year end", () => {
    const r = reservation(event({ start: { dateTime: "2025-12-31T15:00:00Z" } }), "입학 상담", "a", "2026-01");
    expect(r).toMatchObject({ date: "2026-01-01", time: "00:00" });
    expect(reservation(event({ start: { dateTime: "2025-12-31T14:59:59Z" } }), "입학 상담", "a", "2026-01")).toBeNull();
  });
  it("rejects invalid/missing/timezone-less dates; all-day start stays on its date", () => {
    for (const start of [{ date: "2026-02-30" }, { dateTime: "bad" }, { dateTime: "2026-01-01T10:00:00" }, null])
      expect(reservation(event({ start }), "입학 상담", "a", "2026-01")).toBeNull();
    expect(reservation(event({ start: { date: "2026-01-01" } }), "입학 상담", "a", "2026-01")?.time).toBeNull();
  });
  it("masks contacts and rejects unsafe links", () => {
    const title = displayTitle("가상학생 010-0000-0001 +82 10 0000 0002 sample@example.invalid");
    expect(title).not.toContain("0000"); expect(title).not.toContain("@");
    for (const url of ["javascript:alert(1)", "https://example.com/calendar", "https://calendar.google.com.evil.test/calendar", "https://user@www.google.com/calendar"])
      expect(safeCalendarUrl(url)).toBeNull();
    expect(safeCalendarUrl("https://calendar.google.com/calendar/event?eid=sample")).not.toBeNull();
  });
  it("deduplicates calendar copies with equivalent timestamps, not separate appointments", () => {
    const one = event({ iCalUID: "uid" });
    const a = source([one, event({ id: "different", iCalUID: "separate" })]);
    const b = source([event({ id: "copy", iCalUID: "uid", start: { dateTime: "2026-01-04T16:00:00+09:00" } })]);
    const result = mergeMonth("2026-01", [a, b], "now");
    expect(counts(result).active).toBe(2); expect(result.duplicates).toBe(1);
  });
  it("preserves recurring occurrences and marks conflicting copies for review", () => {
    const a = source([event({ iCalUID: "uid", recurringEventId: "series" }), event({ id: "next", iCalUID: "uid", recurringEventId: "series", start: { date: "2026-01-05" } })]);
    const b = source([event({ id: "copy", iCalUID: "uid", recurringEventId: "series", status: "cancelled" })]);
    const result = mergeMonth("2026-01", [a, b], "now");
    expect(counts(result)).toMatchObject({ active: 1, review: 1 });
  });
  it("deduplicates moved recurring instances by original occurrence", () => {
    const originalStartTime = { date: "2026-01-04" };
    const a = source([event({ iCalUID: "uid", originalStartTime })]);
    const b = source([event({ id: "copy", iCalUID: "uid", originalStartTime, start: { date: "2026-01-06" } })]);
    expect(counts(mergeMonth("2026-01", [a, b], "now")).review).toBe(1);
  });
  it("never presents no connection/partial retrieval as complete zero", () => {
    expect(mergeMonth("2026-01", [], "now").complete).toBe(false);
    expect(mergeMonth("2026-01", [source([], { complete: false })], "now").complete).toBe(false);
    expect(mergeMonth("2026-01", [source([])], "now").complete).toBe(true);
  });
  it("holds moved copies spanning months without conflating recurring appointments", () => {
    const jan = mergeMonth("2026-01", [source([event({ iCalUID: "move" })])], "now");
    const febRecord = reservation(event({ id: "copy", iCalUID: "move", start: { date: "2026-02-01" } }), "입학 상담", "b", "2026-02")!;
    const feb = { ...jan, month: "2026-02", records: [febRecord] };
    const output = reconcileMonths({ "2026-01": jan, "2026-02": feb });
    expect(counts(output["2026-01"])).toMatchObject({ active: 0, review: 1 });
    expect(counts(output["2026-02"])).toMatchObject({ active: 0, review: 1 });
    expect(jan.records[0].status).toBe("active");
  });
  it("suppresses unfinished month, missing data, mismatched scope and zero-denominator percentages", () => {
    const now = mergeMonth("2026-01", [source([event()])], "now", "same");
    const prior = { ...now, month: "2025-01" };
    expect(comparison(now, prior, "2026-02-01")).toBe("0%");
    expect(comparison(now, prior, "2026-01-31")).toBe("비교 보류");
    expect(comparison(now, undefined, "2026-02-01")).toBe("비교 보류");
    expect(comparison(now, { ...prior, scope: "other" }, "2026-02-01")).toBe("비교 보류");
    expect(comparison(now, { ...prior, records: [] }, "2026-02-01")).toBe("전년 0건");
  });
});
