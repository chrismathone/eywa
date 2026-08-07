import { describe, expect, it } from "vitest";
import {
  formatDays,
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

  // 🔴 쉼표 없이 붙여 쓰는 게 사람에겐 더 자연스럽다. 예전엔 split(",")만 해서 "월수목"이
  //    통째로 오타 취급 → 요일 0개 → **시수가 0**이 됐다(원장 제보 2026-08-07).
  it("쉼표 없이 붙여 써도 읽는다", () => {
    expect(parseDays("월수목")).toEqual([1, 3, 4]);
    expect(parseDays("월수금")).toEqual([1, 3, 5]);
    expect(parseDays("화목")).toEqual([2, 4]);
  });

  it("구분자가 무엇이든 상관없다", () => {
    expect(parseDays("월 수 금")).toEqual([1, 3, 5]);
    expect(parseDays("월/수/금")).toEqual([1, 3, 5]);
    expect(parseDays("월·수·금")).toEqual([1, 3, 5]);
    // ⚠️ "월요일"은 '요일'의 '일'이 일요일로 잡히면 안 된다 — 파서가 '요일'을 먼저 걷어낸다.
    expect(parseDays("월요일, 수요일")).toEqual([1, 3]);
  });

  it("같은 요일을 두 번 써도 한 번만 센다(시수 부풀림 방지)", () => {
    expect(parseDays("월,월,수")).toEqual([1, 3]);
    expect(parseDays("월월")).toEqual([1]);
  });
});

describe("formatDays — 입력 칸 자동 정리", () => {
  it("붙여 쓴 요일을 쉼표 표기로", () => {
    expect(formatDays("월수목")).toBe("월,수,목");
    expect(formatDays("화목")).toBe("화,목");
  });

  it("이미 정리된 값은 그대로", () => {
    expect(formatDays("월,수,금")).toBe("월,수,금");
  });

  it("사람이 친 순서를 유지한다(시수는 순서와 무관)", () => {
    expect(formatDays("금월")).toBe("금,월");
  });

  // 🔴 읽을 요일이 없으면 빈 문자열 — 호출부는 그때 원래 입력을 지우지 않는다.
  it("요일이 하나도 없으면 빈 문자열", () => {
    expect(formatDays("dnjftn")).toBe("");
    expect(formatDays("")).toBe("");
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
