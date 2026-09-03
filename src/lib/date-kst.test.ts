import { describe, expect, it } from "vitest";
import {
  kstToday,
  kstMonthStart,
  kstMonth,
  kstMinutesOfDay,
  resolveReportDate,
  weekdayIndexOf,
  addDays,
  inclusiveDateWindowStart,
  formatKoreanDate,
  kstDateOf,
  kstTimeOf,
} from "./date-kst";

describe("date-kst — KST(Asia/Seoul) 기준 오늘/이번 달", () => {
  it("UTC 자정 직전(08:59 KST 전, 한국은 다음날)이라도 KST 날짜로 계산", () => {
    // 2026-06-29 23:30 UTC = 2026-06-30 08:30 KST → KST '오늘'은 30일
    const d = new Date("2026-06-29T23:30:00Z");
    expect(kstToday(d)).toBe("2026-06-30");
    // 같은 순간을 UTC slice하면 29일(=버그) — 헬퍼는 30일로 교정
    expect(d.toISOString().slice(0, 10)).toBe("2026-06-29");
  });

  it("UTC 낮 시간은 KST도 같은 날", () => {
    const d = new Date("2026-06-30T05:00:00Z"); // 14:00 KST
    expect(kstToday(d)).toBe("2026-06-30");
  });

  it("월 경계 — UTC 6/30 23:00 = KST 7/1 08:00 → 이번 달은 7월", () => {
    const d = new Date("2026-06-30T23:00:00Z");
    expect(kstToday(d)).toBe("2026-07-01");
    expect(kstMonthStart(d)).toBe("2026-07-01");
    expect(kstMonth(d)).toBe("2026-07");
  });

  it("kstMonthStart/kstMonth는 KST 오늘에서 파생", () => {
    const d = new Date("2026-03-15T04:00:00Z"); // 13:00 KST 3/15
    expect(kstMonthStart(d)).toBe("2026-03-01");
    expect(kstMonth(d)).toBe("2026-03");
  });

  it("kstMinutesOfDay — UTC가 아닌 KST 시각의 분(슬롯 상태 판정용)", () => {
    // 05:00 UTC = 14:00 KST → 14*60=840 (UTC면 300이라 오판)
    expect(kstMinutesOfDay(new Date("2026-06-30T05:00:00Z"))).toBe(14 * 60);
    // 23:30 UTC = 08:30 KST → 8*60+30=510
    expect(kstMinutesOfDay(new Date("2026-06-29T23:30:00Z"))).toBe(8 * 60 + 30);
  });
});

describe("resolveReportDate — 작성·발송 대상 날짜 클램프", () => {
  const today = "2026-07-14";
  it("빈값·형식오류·null은 오늘로", () => {
    expect(resolveReportDate(undefined, today)).toBe(today);
    expect(resolveReportDate(null, today)).toBe(today);
    expect(resolveReportDate("", today)).toBe(today);
    expect(resolveReportDate("2026-7-1", today)).toBe(today); // 0패딩 아님 = 형식오류
    expect(resolveReportDate("abcd-ef-gh", today)).toBe(today);
  });
  it("과거 날짜는 그대로(저장 허용)", () => {
    expect(resolveReportDate("2026-07-10", today)).toBe("2026-07-10");
    expect(resolveReportDate("2026-06-01", today)).toBe("2026-06-01");
    expect(resolveReportDate("2025-01-01", today)).toBe("2025-01-01");
  });
  it("오늘은 그대로", () => {
    expect(resolveReportDate(today, today)).toBe(today);
  });
  it("미래는 오늘로 클램프(미래 보고서 금지)", () => {
    expect(resolveReportDate("2026-07-15", today)).toBe(today);
    expect(resolveReportDate("2027-01-01", today)).toBe(today);
  });
});

describe("weekdayIndexOf / addDays / formatKoreanDate — UTC 결정적 날짜 유틸", () => {
  it("weekdayIndexOf: 2026-07-14 = 화(2)", () => {
    expect(weekdayIndexOf("2026-07-14")).toBe(2);
    expect(weekdayIndexOf("2026-07-13")).toBe(1); // 월
    expect(weekdayIndexOf("2026-07-12")).toBe(0); // 일
  });
  it("addDays: 이전/다음 + 월·연 경계", () => {
    expect(addDays("2026-07-14", -1)).toBe("2026-07-13");
    expect(addDays("2026-07-14", 1)).toBe("2026-07-15");
    expect(addDays("2026-07-01", -1)).toBe("2026-06-30"); // 월 경계
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31"); // 연 경계
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01"); // 비윤년 2월
  });
  it("inclusiveDateWindowStart: 오늘을 포함해 정확히 N일을 계산", () => {
    expect(inclusiveDateWindowStart("2026-07-16", 7)).toBe("2026-07-10");
    expect(inclusiveDateWindowStart("2026-07-16", 30)).toBe("2026-06-17");
    expect(inclusiveDateWindowStart("2026-07-16", 1)).toBe("2026-07-16");
    expect(inclusiveDateWindowStart("2026-07-16", 0)).toBe("2026-07-16");
  });
  it("formatKoreanDate: 한글 표시", () => {
    expect(formatKoreanDate("2026-07-14")).toBe("2026년 7월 14일 (화)");
    expect(formatKoreanDate("2026-07-13")).toBe("2026년 7월 13일 (월)");
  });
});

describe("kstDateOf — 타임스탬프를 KST 날짜로(UTC slice 금지)", () => {
  it("🔴 UTC 날짜와 갈리는 구간(00:00~08:59 KST)에서 하루 전으로 적히지 않는다", () => {
    // 2026-08-26 01:00 KST = 2026-08-25T16:00Z — slice(0,10)이면 8/25(하루 전)로 적힌다.
    expect(kstDateOf("2026-08-25T16:00:00.000Z")).toBe("2026-08-26");
    expect("2026-08-25T16:00:00.000Z".slice(0, 10)).toBe("2026-08-25"); // 옛 방식이 틀렸음을 못박음
  });
  it("같은 날인 구간은 그대로", () => {
    expect(kstDateOf("2026-08-25T08:05:00.000Z")).toBe("2026-08-25");
    expect(kstDateOf(new Date("2026-08-25T23:59:59.000Z"))).toBe("2026-08-26");
  });
  it("빈값·형식오류는 null(없는 날짜를 지어내지 않는다)", () => {
    expect(kstDateOf(null)).toBeNull();
    expect(kstDateOf("")).toBeNull();
    expect(kstDateOf("   ")).toBeNull();
    expect(kstDateOf("garbage")).toBeNull();
    expect(kstDateOf(new Date(NaN))).toBeNull();
    expect(kstDateOf(12345)).toBeNull();
  });
});

describe("kstTimeOf — 타임스탬프를 KST 시각으로(UTC slice 금지)", () => {
  it("🔴 UTC 시각과 9시간 어긋나지 않는다", () => {
    // 셔틀 "13:46 출발"은 2026-09-02T04:46Z다. slice(11,16)이면 04:46(9시간 이른 시각)으로 보인다.
    expect(kstTimeOf("2026-09-02T04:46:00.000Z")).toBe("13:46");
    expect("2026-09-02T04:46:00.000Z".slice(11, 16)).toBe("04:46"); // 옛 방식이 틀렸음을 못박음
  });

  it("자정을 넘는 구간도 24시간제로 답한다", () => {
    // 2026-09-02T15:30Z = 2026-09-03 00:30 KST — 12시간제면 "12:30 AM"이 된다.
    expect(kstTimeOf("2026-09-02T15:30:00.000Z")).toBe("00:30");
    expect(kstTimeOf("2026-09-02T14:00:00.000Z")).toBe("23:00");
  });

  it("Date 객체도 받는다", () => {
    expect(kstTimeOf(new Date("2026-09-02T00:00:00.000Z"))).toBe("09:00");
  });

  it("빈값·형식오류는 null(없는 시각을 지어내지 않는다)", () => {
    expect(kstTimeOf(null)).toBeNull();
    expect(kstTimeOf("")).toBeNull();
    expect(kstTimeOf("   ")).toBeNull();
    expect(kstTimeOf("garbage")).toBeNull();
    expect(kstTimeOf(new Date(NaN))).toBeNull();
  });
});
