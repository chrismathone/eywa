import { describe, expect, it } from "vitest";
import { activeDowsOf, cellDateOf, monthDates, monthWeeks, normalizeMonth, rangeDates, rangeWeeks } from "./month";

describe("normalizeMonth — 깨진 URL로 화면이 죽지 않게", () => {
  it("모양이 맞으면 그대로", () => {
    expect(normalizeMonth("2026-08", "2026-01")).toBe("2026-08");
  });

  it("모양이 아니거나 없는 달이면 폴백", () => {
    expect(normalizeMonth(null, "2026-08")).toBe("2026-08");
    expect(normalizeMonth("2026-8", "2026-08")).toBe("2026-08");
    expect(normalizeMonth("2026-13", "2026-08")).toBe("2026-08"); // 모양은 맞지만 없는 달
    expect(normalizeMonth("2026-00", "2026-08")).toBe("2026-08");
  });
});

describe("monthDates — 말일을 UTC 파싱으로 잃지 않는다", () => {
  it("31일 달", () => {
    const d = monthDates("2026-08");
    expect(d).toHaveLength(31);
    expect(d[0]).toBe("2026-08-01");
    expect(d[30]).toBe("2026-08-31");
  });

  it("2월(평년)", () => {
    expect(monthDates("2026-02")).toHaveLength(28);
  });
});

describe("monthWeeks — 주 행은 월요일 기준이고 그 달 날짜만 담는다", () => {
  // 2026-08-01은 토요일 → 첫 주의 월요일은 7/27(달 밖)이고, 그 주에 속한 8월 날짜는 1·2뿐이다.
  const weeks = monthWeeks("2026-08");

  it("주 행 수와 월요일", () => {
    expect(weeks.map((w) => w.monday)).toEqual([
      "2026-07-27",
      "2026-08-03",
      "2026-08-10",
      "2026-08-17",
      "2026-08-24",
      "2026-08-31",
    ]);
  });

  it("첫 주는 이 달 날짜만 담는다(지난달 계획이 섞이면 안 된다)", () => {
    expect(weeks[0]!.dates).toEqual(["2026-08-01", "2026-08-02"]);
    expect(weeks[0]!.index).toBe(1);
  });

  it("마지막 주는 하루뿐일 수 있다", () => {
    expect(weeks[5]!.dates).toEqual(["2026-08-31"]);
  });

  it("모든 날짜가 정확히 한 주에 한 번씩 들어간다", () => {
    const all = weeks.flatMap((w) => w.dates);
    expect(all).toEqual(monthDates("2026-08"));
  });
});

describe("cellDateOf — 격자 칸의 날짜(달 밖이면 빈 칸)", () => {
  const weeks = monthWeeks("2026-08");

  it("달 밖 월요일 칸은 null", () => {
    expect(cellDateOf(weeks[0]!, "mon")).toBeNull(); // 7/27
    expect(cellDateOf(weeks[0]!, "sat")).toBe("2026-08-01");
  });

  it("마지막 주도 달을 넘기지 않는다", () => {
    expect(cellDateOf(weeks[5]!, "mon")).toBe("2026-08-31");
    expect(cellDateOf(weeks[5]!, "wed")).toBeNull(); // 9/2
  });
});

describe("activeDowsOf — 실제로 배정이 있는 요일만, 월→일 순", () => {
  it("입력 순서에 좌우되지 않는다", () => {
    // 중등E_초6 SKY = 월·수·목(실측)
    expect(activeDowsOf(["2026-08-06", "2026-08-03", "2026-08-05"])).toEqual(["mon", "wed", "thu"]);
  });

  it("배정이 없으면 빈 배열(호출부가 '수업 없음'을 그린다)", () => {
    expect(activeDowsOf([])).toEqual([]);
  });

  it("주말도 자리를 잃지 않는다", () => {
    expect(activeDowsOf(["2026-08-01", "2026-08-02", "2026-08-03"])).toEqual(["mon", "sat", "sun"]);
  });
});

describe("rangeWeeks · cellDateOf — 달을 넘는 세션 창(2026-09-21 월/세션 전환)", () => {
  // 실데이터: 영어 10월 세션 = 10/1(목) ~ 11/2(월).
  const weeks = rangeWeeks("2026-10-01", "2026-11-02");

  it("창 안의 날짜만 담는다 — 첫 주는 목·금·토·일, 마지막 주는 11/2 하루", () => {
    expect(weeks[0]!.monday).toBe("2026-09-28");
    expect(weeks[0]!.dates).toEqual(["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
    expect(weeks.at(-1)!.monday).toBe("2026-11-02");
    expect(weeks.at(-1)!.dates).toEqual(["2026-11-02"]);
    expect(weeks.map((w) => w.index)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("🔴 다음 달로 넘어간 날(11/2)도 칸이 선다 — 달 접두로 보면 빈 칸이 된다", () => {
    expect(cellDateOf(weeks.at(-1)!, "mon")).toBe("2026-11-02");
    expect(cellDateOf(weeks.at(-1)!, "tue")).toBeNull(); // 11/3 = 11월 세션
    expect(cellDateOf(weeks[0]!, "wed")).toBeNull(); // 9/30 = 9월 세션
  });

  it("달력월과 같은 창이면 monthWeeks와 똑같다(월 모드 회귀 없음)", () => {
    expect(rangeWeeks("2026-08-01", "2026-08-31")).toEqual(monthWeeks("2026-08"));
    expect(rangeDates("2026-08-01", "2026-08-31")).toEqual(monthDates("2026-08"));
  });

  it("깨진 창은 빈 배열(무한 루프·쓰레기 주 없음)", () => {
    expect(rangeDates("2026-10-05", "2026-10-01")).toEqual([]);
    expect(rangeDates("", "2026-10-01")).toEqual([]);
    expect(rangeWeeks("쓰레기", "2026-10-01")).toEqual([]);
  });
});
