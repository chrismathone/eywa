import { describe, expect, it } from "vitest";
import { countTeachingDays, findGapDays, suggestEndDate, verifyPeriodShape } from "./verify";

// 2026-01-05 = 월요일. 원장 확인: 영어 1월 세션은 1/5 시작.
describe("countTeachingDays", () => {
  it("공휴일 없는 4주는 요일마다 정확히 4회", () => {
    expect(countTeachingDays("2026-01-05", "2026-01-30")).toEqual({ 1: 4, 2: 4, 3: 4, 4: 4, 5: 4 });
  });

  it("주말은 세지 않는다(세션에는 편입되지만 회차가 아니다)", () => {
    // 1/5(월)~1/11(일) = 평일 5일 + 주말 2일
    expect(countTeachingDays("2026-01-05", "2026-01-11")).toEqual({ 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 });
  });

  it("공휴일은 그 요일에서 빠진다", () => {
    // 설 연휴 2/16(월)·2/17(화) 휴원
    const counts = countTeachingDays("2026-02-02", "2026-02-27", ["2026-02-16", "2026-02-17"]);
    expect(counts).toEqual({ 1: 3, 2: 3, 3: 4, 4: 4, 5: 4 });
  });

  it("거꾸로 된 구간·깨진 형식은 0", () => {
    expect(countTeachingDays("2026-02-27", "2026-02-02")).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
    expect(countTeachingDays("2026-2-2", "2026-02-27")).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
  });
});

describe("suggestEndDate — 입력 보조", () => {
  it("공휴일이 없으면 4주 뒤 금요일", () => {
    expect(suggestEndDate("2026-01-05")).toBe("2026-01-30");
  });

  it("공휴일로 빠진 요일을 채우려고 달을 넘긴다", () => {
    // 2/2 시작, 설 연휴 2/16·17·18 휴원 → 월·화·수가 3월로 밀린다
    const end = suggestEndDate("2026-02-02", ["2026-02-16", "2026-02-17", "2026-02-18"]);
    expect(end).toBe("2026-03-04"); // 수요일 4회째
    // 그 구간을 다시 세면 전부 4회여야 한다(자기 일관성)
    expect(countTeachingDays("2026-02-02", end!, ["2026-02-16", "2026-02-17", "2026-02-18"])).toEqual({
      1: 4,
      2: 4,
      3: 4,
      4: 4,
      5: 4,
    });
  });

  it("주말에 시작해도 첫 평일부터 센다", () => {
    expect(suggestEndDate("2026-01-03")).toBe("2026-01-30"); // 토요일 시작
  });

  it("깨진 입력은 null", () => {
    expect(suggestEndDate("")).toBeNull();
    expect(suggestEndDate("2026-01-05", [], 0)).toBeNull();
  });
});

describe("verifyPeriodShape — 경고만, 저장은 막지 않는다", () => {
  it("월~금 각 4회면 통과", () => {
    const r = verifyPeriodShape("2026-01-05", "2026-01-30");
    expect(r.ok).toBe(true);
    expect(r.warning).toBeNull();
    expect(r.shortDows).toEqual([]);
    expect(r.overDows).toEqual([]);
  });

  it("부족한 요일을 한글로 알린다", () => {
    const r = verifyPeriodShape("2026-02-02", "2026-02-27", ["2026-02-16", "2026-02-17"]);
    expect(r.ok).toBe(false);
    expect(r.shortDows).toEqual(["월", "화"]);
    expect(r.warning).toContain("월·화요일이 4회에 못 미칩니다");
    expect(r.warning).toContain("그대로 저장하세요"); // 막지 않는다는 안내
  });

  // 🔴 넘침은 결함이 아니다 — 공휴일로 빠진 요일을 채우려 기간을 늘리면 다른 요일은 반드시 5회가 된다.
  //    (2026-08-07 실화면: '빈 달 이어서 채우기'가 만든 6·7월이 이 규칙 때문에 경고로 잡혔었다.)
  it("넘치는 요일은 통과시키되 사실만 설명한다", () => {
    const r = verifyPeriodShape("2026-01-05", "2026-02-06");
    expect(r.ok).toBe(true); // 부족한 요일이 없으므로 통과
    expect(r.warning).toBeNull();
    expect(r.note).toContain("공휴일을 채우느라");
    expect(r.overDows.length).toBeGreaterThan(0);
  });

  it("자동 제안(suggestEndDate)이 만든 구간은 절대 '부족'으로 잡히지 않는다", () => {
    // 설 연휴가 낀 2월: 월·화·수가 3월로 밀리면서 목·금은 5회가 된다 — 그래도 통과해야 한다.
    const holidays = ["2026-02-16", "2026-02-17", "2026-02-18"];
    for (const start of ["2026-01-05", "2026-02-02", "2026-05-25", "2026-06-25"]) {
      const end = suggestEndDate(start, holidays);
      expect(end).not.toBeNull();
      const r = verifyPeriodShape(start, end!, holidays);
      expect(r.ok, `${start}~${end} 가 부족으로 잡혔다: ${r.warning}`).toBe(true);
      expect(r.shortDows).toEqual([]);
    }
  });

  it("경고 메시지에 영문 코드가 새지 않는다", () => {
    const r = verifyPeriodShape("2026-02-02", "2026-02-27", ["2026-02-16"]);
    expect(r.warning).not.toMatch(/[a-zA-Z]{3,}/);
  });
});

describe("findGapDays — 세션 사이 빈 날", () => {
  it("연속이면 빈 날 없음", () => {
    expect(findGapDays("2026-01-30", "2026-01-31")).toEqual([]);
  });

  it("사이가 뜨면 그 날들을 돌려준다", () => {
    expect(findGapDays("2026-04-02", "2026-04-06")).toEqual(["2026-04-03", "2026-04-04", "2026-04-05"]);
  });

  it("겹치면(다음 시작이 더 이르면) 빈 배열 — 겹침은 DB가 막는다", () => {
    expect(findGapDays("2026-04-02", "2026-04-01")).toEqual([]);
  });
});
