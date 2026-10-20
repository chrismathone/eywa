import { describe, expect, it } from "vitest";
import { historyEvidence, registrationEvidence, safeCalendarUrl, titleHasName, type HistoryEvent } from "./evidence";
const identity = { name: "테스트학생", phones: ["010-0000-0001"] };
const event = (extra: Partial<HistoryEvent> = {}): HistoryEvent => ({
  id: "one", calendarId: "sample", source: "입학 상담", title: "입테 테스트학생(가상초6) 010.0000.0001",
  start: "2023-05-01T17:00:00+09:00", date: "2023-05-01", cancelled: false, ...extra,
});
describe("pre-consultation evidence, synthetic students only", () => {
  it("recognizes six records across school/grade changes without declaring six completed consultations", () => {
    const events = Array.from({length:6}, (_,i) => event({id:String(i), date:`202${i}-05-01`, title:`상담 테스트학생(가상중${i}) 01000000001`}));
    const r = historyEvidence(events,identity,"2025-05-01");
    expect(r.matchedRecords).toBe(6); expect(r.priorRecords).toBe(5); expect(r.visitDates).toBe(6);
    expect(registrationEvidence([],identity)).toBe("unconfirmed");
  });
  it("does not match a partial name, staff mentioning another name, or a homonym with another phone", () => {
    expect(titleHasName("테스트학생이 상담",identity.name)).toBe(false);
    const r = historyEvidence([event({title:"상담 테스트학생 010-0000-0002"})],identity,"2026-10-19");
    expect(r.matchedRecords).toBe(0); expect(r.ambiguous).toBe(1);
  });
  it("excludes cancelled/future records from counts, shows cancellation evidence", () => {
    const r = historyEvidence([event({title:"[취 소] 테스트학생 01000000001"}),event({id:"future",date:"2030-01-01"})],identity,"2026-10-19");
    expect(r.matchedRecords).toBe(0); expect(r.cancelled).toBe(1); expect(r.rows).toHaveLength(1);
  });
  it("deduplicates the same Google occurrence copied across calendars", () => {
    const r = historyEvidence([event({uid:"ical"}),event({id:"copy",calendarId:"trial",uid:"ical",start:"2023-05-01T08:00:00Z"})],identity,"2026-10-19");
    expect(r.matchedRecords).toBe(1); expect(r.duplicates).toBe(1);
  });
  it("does not combine different subjects on the same day into a fabricated consultation", () => {
    const r = historyEvidence([event(),event({id:"two"})],identity,"2026-10-19");
    expect(r.matchedRecords).toBe(2); expect(r.visitDates).toBe(1);
  });
  it("treats missing phone as ambiguous, never matching by school alone", () => {
    expect(historyEvidence([event()],{...identity,phones:[]},"2026-10-19").ambiguous).toBe(1);
  });
  it("returns only minimal evidence, no raw phone or title", () => {
    const out = JSON.stringify(historyEvidence([event()],identity,"2026-10-19"));
    expect(out).not.toContain("010"); expect(out).not.toContain("가상초"); expect(out).not.toContain("테스트학생");
  });
  it("recognizes historical registration but does not infer it from a prospect record", () => {
    const row = { name: identity.name, parent_phone:"010.0000.0001",student_phone:null,status:"prospect",enrolled_at:null };
    expect(registrationEvidence([row],identity)).toBe("unconfirmed");
    expect(registrationEvidence([{...row,status:"withdrawn"}],identity)).toBe("found");
    expect(registrationEvidence([{...row,status:"enrolled",parent_phone:"01000000002"}],identity)).toBe("unconfirmed");
  });
  it("rejects unsafe links", () => {
    expect(safeCalendarUrl("javascript:alert(1)")).toBeNull();
    expect(safeCalendarUrl("https://calendar.google.com.evil.invalid/calendar/event")).toBeNull();
    expect(safeCalendarUrl("https://www.google.com/calendar/event?eid=sample")).toBeTruthy();
  });
});
