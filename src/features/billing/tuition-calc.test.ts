import { describe, expect, it } from "vitest";
import {
  countSessions,
  estimateTuition,
  fixedHolidaysForYear,
  mergeHolidays,
  resolveDueDate,
} from "./tuition-calc";

describe("resolveDueDate", () => {
  it("기간 + 마감일(N) → 그 달 N일", () => {
    expect(resolveDueDate("2026-03", 10)).toBe("2026-03-10");
  });
  it("말일 초과 dueDay는 그 달 말일로 clamp (2월 31 → 28)", () => {
    expect(resolveDueDate("2026-02", 31)).toBe("2026-02-28");
  });
  it("잘못된 기간이면 빈 문자열", () => {
    expect(resolveDueDate("bad", 10)).toBe("");
  });
});

describe("mergeHolidays", () => {
  it("설정 휴일 + 고정 공휴일 합치고 중복 제거", () => {
    const r = mergeHolidays(2026, ["2026-05-05", "2026-12-30"], true);
    expect(r).toContain("2026-12-30"); // 테넌트 추가 휴일
    expect(r.filter((d) => d === "2026-05-05")).toHaveLength(1); // 어린이날 중복 제거
  });
  it("includeFixed=false면 설정 휴일만", () => {
    expect(mergeHolidays(2026, ["2026-12-30"], false)).toEqual(["2026-12-30"]);
  });
  it("설정 빈 배열 + 고정 포함이면 fixedHolidaysForYear와 동일(동등성)", () => {
    expect(mergeHolidays(2026, [], true).sort()).toEqual(fixedHolidaysForYear(2026).sort());
  });
});

describe("countSessions", () => {
  it("월·수·금 한 주(2026-03-02 월 ~ 03-08 일) = 3차시", () => {
    // 2026-03-02 = 월요일
    expect(countSessions("2026-03-02", "2026-03-08", [1, 3, 5])).toBe(3);
  });

  it("2주면 6차시", () => {
    expect(countSessions("2026-03-02", "2026-03-15", [1, 3, 5])).toBe(6);
  });

  it("공휴일 제외", () => {
    // 월·수·금 2주 중 수요일(03-04) 하루를 공휴일로 제외 → 5
    expect(countSessions("2026-03-02", "2026-03-15", [1, 3, 5], ["2026-03-04"])).toBe(5);
  });

  it("빈 요일·역순·빈 날짜는 0", () => {
    expect(countSessions("2026-03-02", "2026-03-08", [])).toBe(0);
    expect(countSessions("2026-03-08", "2026-03-02", [1])).toBe(0);
    expect(countSessions("", "2026-03-08", [1])).toBe(0);
  });
});

describe("estimateTuition", () => {
  it("차시 × 단가 − 할인", () => {
    expect(estimateTuition({ sessions: 8, perSession: 30000, discount: 20000 })).toEqual({
      sessions: 8,
      gross: 240000,
      discount: 20000,
      total: 220000,
    });
  });
  it("할인은 gross 초과 못 함, 음수 방어", () => {
    const r = estimateTuition({ sessions: 4, perSession: 10000, discount: 999999 });
    expect(r.gross).toBe(40000);
    expect(r.discount).toBe(40000);
    expect(r.total).toBe(0);
  });
  it("차시 0이면 0원", () => {
    expect(estimateTuition({ sessions: 0, perSession: 30000 }).total).toBe(0);
  });
});

describe("fixedHolidaysForYear", () => {
  it("양력 고정 공휴일 8개", () => {
    const h = fixedHolidaysForYear(2026);
    expect(h).toHaveLength(8);
    expect(h).toContain("2026-01-01");
    expect(h).toContain("2026-12-25");
  });
});
