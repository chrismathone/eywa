import { describe, expect, it } from "vitest";
import { monthAheadNote, monthAheadWindow, windowUntilLabel } from "./upcoming-window";

describe("monthAheadWindow — 오늘부터 한 달(원장 2026-09-16)", () => {
  it("다음 달 같은 날의 전날까지 — 옛 '오늘부터 7일'(오늘+6)과 같은 셈법", () => {
    expect(monthAheadWindow("2026-09-16")).toEqual({ start: "2026-09-16", end: "2026-10-15" });
    expect(monthAheadWindow("2026-09-10")).toEqual({ start: "2026-09-10", end: "2026-10-09" });
  });

  it("1일이면 그 달 말일까지", () => {
    expect(monthAheadWindow("2026-09-01")).toEqual({ start: "2026-09-01", end: "2026-09-30" });
    expect(monthAheadWindow("2027-02-01")).toEqual({ start: "2027-02-01", end: "2027-02-28" });
  });

  it("연말을 넘긴다", () => {
    expect(monthAheadWindow("2026-12-16")).toEqual({ start: "2026-12-16", end: "2027-01-15" });
    expect(monthAheadWindow("2026-12-31")).toEqual({ start: "2026-12-31", end: "2027-01-30" });
  });

  it("다음 달에 같은 날이 없으면 다음 달 말일까지(그 달 마지막 날을 빠뜨리지 않는다)", () => {
    expect(monthAheadWindow("2027-01-31").end).toBe("2027-02-28");
    expect(monthAheadWindow("2027-01-29").end).toBe("2027-02-28");
    expect(monthAheadWindow("2028-01-31").end).toBe("2028-02-29"); // 윤년
    expect(monthAheadWindow("2028-01-29").end).toBe("2028-02-28");
    expect(monthAheadWindow("2026-03-31").end).toBe("2026-04-30");
    expect(monthAheadWindow("2026-08-31").end).toBe("2026-09-30");
  });

  it("끝 날짜는 날이 갈수록 뒤로만 간다(월말 보정이 창을 되감지 않는다)", () => {
    let prev = "";
    for (let d = new Date(Date.UTC(2026, 0, 1)); d < new Date(Date.UTC(2029, 0, 1)); d.setUTCDate(d.getUTCDate() + 1)) {
      const ymd = d.toISOString().slice(0, 10);
      const { start, end } = monthAheadWindow(ymd);
      expect(start).toBe(ymd);
      expect(end >= start).toBe(true);
      expect(end >= prev).toBe(true);
      prev = end;
    }
  });

  it("날짜가 아니면 오늘 하나만(지어낸 범위로 조회하지 않는다)", () => {
    expect(monthAheadWindow("2026-13-99")).toEqual({ start: "2026-13-99", end: "2026-13-99" });
  });
});

describe("문구 — 창의 이름만이 아니라 끝 날짜를 적는다(#121)", () => {
  it("카드·팝업·패널이 같은 날짜 표기", () => {
    const range = monthAheadWindow("2026-09-16");
    expect(windowUntilLabel(range)).toBe("10/15 (목)까지");
    expect(monthAheadNote(range)).toBe("오늘부터 한 달 · 10/15 (목)까지");
  });
});
