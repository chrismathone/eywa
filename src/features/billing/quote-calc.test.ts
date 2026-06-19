import { describe, expect, it } from "vitest";
import {
  parseDays,
  splitCoursesByMonth,
  quoteTotal,
  autoSessions,
  type QuoteCourse,
} from "./quote-calc";

const course = (over: Partial<QuoteCourse>): QuoteCourse => ({
  uid: "u",
  category: "수학",
  name: "테스트반",
  days: "월",
  perSession: 10000,
  sessions: 0,
  price: 0,
  note: "",
  excludeHolidays: true,
  fixedMonthly: false,
  ...over,
});

describe("parseDays", () => {
  it("한글 요일 → 인덱스(0=일~6=토)", () => {
    expect(parseDays("월,수,금")).toEqual([1, 3, 5]);
    expect(parseDays("토, 일")).toEqual([6, 0]);
  });
  it("빈/오타 토큰 무시", () => {
    expect(parseDays("월,,X")).toEqual([1]);
  });
});

describe("autoSessions", () => {
  it("2026년 6월 월요일 = 5회 (6/1 월요일)", () => {
    // 2026-06: Mondays 1,8,15,22,29
    expect(autoSessions("월", "2026-06-01", "2026-06-30", [])).toBe(5);
  });
  it("공휴일 제외 시 차감", () => {
    expect(autoSessions("월", "2026-06-01", "2026-06-30", ["2026-06-08"])).toBe(4);
  });
});

describe("splitCoursesByMonth", () => {
  it("한 달 내 과목 = 단일 행, 소계 없음", () => {
    const lines = splitCoursesByMonth(
      [course({ days: "월", sessions: 5, price: 50000 })],
      "2026-06-01",
      "2026-06-30",
      [],
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].sessions).toBe(5);
    expect(lines[0].price).toBe(50000);
    expect(lines[0].isSubtotal).toBeUndefined();
  });

  it("두 달 걸치면 월별 행 + 소계, 금액 비례 분배", () => {
    // 6월 월 5회 + 7월 월 4회 = 9회, 총액 90000 → 6월 50000 / 7월 40000 / 소계 90000
    const lines = splitCoursesByMonth(
      [course({ days: "월", sessions: 9, price: 90000 })],
      "2026-06-01",
      "2026-07-31",
      [],
    );
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({ month: "6월", sessions: 5, price: 50000 });
    expect(lines[1]).toMatchObject({ month: "7월", sessions: 4, price: 40000 });
    expect(lines[2]).toMatchObject({ isSubtotal: true, sessions: 9, price: 90000 });
  });

  it("fixedMonthly = 단일 행(자동분할 우회)", () => {
    const lines = splitCoursesByMonth(
      [course({ days: "토", sessions: 12, price: 360000, fixedMonthly: true })],
      "2026-06-01",
      "2026-08-31",
      [],
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ sessions: 12, price: 360000 });
  });

  it("0차시(요일 불일치)면 입력값으로 폴백 단일 행", () => {
    const lines = splitCoursesByMonth(
      [course({ days: "일", sessions: 3, price: 30000 })],
      "2026-06-01",
      "2026-06-02", // 일요일 없음
      [],
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].sessions).toBe(3);
  });
});

describe("quoteTotal", () => {
  it("과목 + 기타 − 할인", () => {
    const t = quoteTotal(
      [course({ price: 300000 }), course({ price: 200000 })],
      [{ uid: "e", name: "교재", price: 12000, note: "" }],
      [{ uid: "d", name: "형제할인", amount: 10000 }],
    );
    expect(t.courseTotal).toBe(500000);
    expect(t.extraTotal).toBe(12000);
    expect(t.discountTotal).toBe(10000);
    expect(t.total).toBe(502000);
  });
  it("과할인 음수 방어", () => {
    const t = quoteTotal([course({ price: 10000 })], [], [{ uid: "d", name: "x", amount: 99999 }]);
    expect(t.total).toBe(0);
  });
});
