import { describe, expect, it } from "vitest";
import { buildIntakeAlert, formatIntakeClasses, formatIntakeDates, shortDate } from "./intake-alert";

describe("formatIntakeDates — 흩어진 날짜를 구간으로 뭉치지 않는다(#100)", () => {
  it("하루", () => {
    expect(formatIntakeDates(["2026-08-19"])).toBe("8/19");
  });
  it("사이에 오는 날이 있는 이틀은 **목록**으로", () => {
    expect(formatIntakeDates(["2026-08-19", "2026-08-21"])).toBe("8/19·8/21");
  });
  it("4일 이상은 '외 N일'", () => {
    expect(formatIntakeDates(["2026-08-19", "2026-08-20", "2026-08-21", "2026-08-24"])).toBe("8/19 외 3일");
  });
  it("중복·정렬을 정리한다", () => {
    expect(formatIntakeDates(["2026-08-21", "2026-08-19", "2026-08-19"])).toBe("8/19·8/21");
  });
  it("빈 목록은 빈 문자열", () => {
    expect(formatIntakeDates([])).toBe("");
  });
  it("shortDate는 0을 뗀다", () => {
    expect(shortDate("2026-08-05")).toBe("8/5");
  });
});

describe("formatIntakeClasses", () => {
  it("3개까지 나열", () => {
    expect(formatIntakeClasses(["A", "B", "C"])).toBe("A·B·C");
  });
  it("넘으면 외 N개", () => {
    expect(formatIntakeClasses(["A", "B", "C", "D"])).toBe("A·B·C 외 1개");
  });
  it("중복 제거", () => {
    expect(formatIntakeClasses(["A", "A"])).toBe("A");
  });
});

describe("buildIntakeAlert", () => {
  const alert = buildIntakeAlert({
    studentName: "김하민",
    dates: ["2026-08-19", "2026-08-21"],
    classNames: ["중2 A", "DP1"],
    reason: "제주도 여행",
    byName: "김동후",
  });

  it("제목에 학생과 날짜 목록", () => {
    expect(alert.title).toBe("김하민 결석 접수 · 8/19·8/21");
  });
  it("본문에 반·사유가 그대로 실린다", () => {
    expect(alert.body).toContain("중2 A·DP1");
    expect(alert.body).toContain("제주도 여행");
  });
  it("🔴 '따로 처리하실 것 없습니다'가 반드시 들어간다 — 이 벨의 목적이 이중 처리 차단이다", () => {
    expect(alert.body).toContain("따로 처리하실 것 없습니다");
    expect(alert.body).toContain("김동후");
  });
  it("사유가 없어도 문장이 깨지지 않는다", () => {
    const noReason = buildIntakeAlert({
      studentName: "김하민",
      dates: ["2026-08-19"],
      classNames: [],
      reason: null,
      byName: null,
    });
    expect(noReason.title).toBe("김하민 결석 접수 · 8/19");
    expect(noReason.body).toContain("데스크가 학부모 연락을 받아");
  });
});
