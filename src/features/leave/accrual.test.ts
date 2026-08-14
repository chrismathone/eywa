import { describe, it, expect } from "vitest";
import {
  addMonths,
  addYears,
  annualGrantFor,
  completedMonths,
  dayBefore,
  leavePeriodLabel,
  resolveLeavePeriod,
} from "./accrual";

describe("응당일 산술(말일 보정)", () => {
  it("1/31 + 1개월 = 2/28, 윤년이면 2/29", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
  });

  it("2/29 + 1년 = 2/28 (개월 산술과 같은 규칙)", () => {
    expect(addYears("2024-02-29", 1)).toBe("2025-02-28");
    expect(addMonths("2024-02-29", 12)).toBe(addYears("2024-02-29", 1));
  });

  it("연말을 넘어가도 정확", () => {
    expect(addMonths("2026-11-15", 3)).toBe("2027-02-15");
    expect(addYears("2026-08-16", 1)).toBe("2027-08-16");
    expect(dayBefore("2027-08-16")).toBe("2027-08-15");
    expect(dayBefore("2026-03-01")).toBe("2026-02-28");
  });

  it("채운 개월 수는 응당일에 도달해야 오른다", () => {
    expect(completedMonths("2026-03-15", "2026-04-14")).toBe(0);
    expect(completedMonths("2026-03-15", "2026-04-15")).toBe(1);
    expect(completedMonths("2026-01-31", "2026-02-27")).toBe(0);
    expect(completedMonths("2026-01-31", "2026-02-28")).toBe(1); // 말일 보정
    expect(completedMonths("2026-01-01", "2027-01-01")).toBe(12);
    expect(completedMonths("2026-05-01", "2026-04-01")).toBe(0); // 역순
  });
});

describe("법정 부여 일수", () => {
  it("1~2년차 15일, 3년차부터 2년마다 +1일", () => {
    expect(annualGrantFor(1)).toBe(15);
    expect(annualGrantFor(2)).toBe(15);
    expect(annualGrantFor(3)).toBe(16);
    expect(annualGrantFor(4)).toBe(16);
    expect(annualGrantFor(5)).toBe(17);
    expect(annualGrantFor(10)).toBe(19);
  });

  it("25일에서 상한", () => {
    expect(annualGrantFor(21)).toBe(25);
    expect(annualGrantFor(23)).toBe(25);
    expect(annualGrantFor(40)).toBe(25);
  });
});

describe("입사 1년 미만 — 1개월 개근마다 1일(최대 11일)", () => {
  const hire = "2026-01-01";

  it("한 달을 채우기 전에는 0일", () => {
    const p = resolveLeavePeriod(hire, "2026-01-31")!;
    expect(p.yearIndex).toBe(0);
    expect(p.granted).toBe(0);
    expect(p.monthly).toBe(true);
    expect(p.label).toBe("입사 1년 미만");
  });

  it("응당일마다 1일씩 늘어난다", () => {
    expect(resolveLeavePeriod(hire, "2026-02-01")!.granted).toBe(1);
    expect(resolveLeavePeriod(hire, "2026-06-01")!.granted).toBe(5);
    expect(resolveLeavePeriod(hire, "2026-12-01")!.granted).toBe(11);
  });

  it("11일을 넘지 않는다(구간 끝까지)", () => {
    expect(resolveLeavePeriod(hire, "2026-12-31")!.granted).toBe(11);
  });

  it("사용 기간은 입사일부터 1년(하루 전까지)", () => {
    const p = resolveLeavePeriod(hire, "2026-06-01")!;
    expect(leavePeriodLabel(p)).toBe("2026-01-01 ~ 2026-12-31");
  });

  it("입사 전 날짜는 0일 — 첫 구간을 그대로 보여준다", () => {
    const p = resolveLeavePeriod(hire, "2025-12-01")!;
    expect(p.granted).toBe(0);
    expect(p.start).toBe(hire);
  });
});

describe("원장이 준 예시 — 2026-08-16에 1년차가 되면 15개", () => {
  // "입사일 ~ 1년단위로 15개 부여 (2026.8.16 날짜로 1년차가 되었으면 2026.08.16~2027.08.15 15개)"
  const hire = "2025-08-16";

  it("1년차 구간과 부여 일수", () => {
    const p = resolveLeavePeriod(hire, "2026-08-16")!;
    expect(p.yearIndex).toBe(1);
    expect(leavePeriodLabel(p)).toBe("2026-08-16 ~ 2027-08-15");
    expect(p.granted).toBe(15);
    expect(p.monthly).toBe(false);
    expect(p.label).toBe("1년차");
  });

  it("1년차 되기 하루 전은 아직 1년 미만(월 적립 11일)", () => {
    const p = resolveLeavePeriod(hire, "2026-08-15")!;
    expect(p.yearIndex).toBe(0);
    expect(p.granted).toBe(11);
    expect(leavePeriodLabel(p)).toBe("2025-08-16 ~ 2026-08-15");
  });

  it("2년차도 15개, 3년차에 16개", () => {
    expect(resolveLeavePeriod(hire, "2027-08-16")!.granted).toBe(15);
    const third = resolveLeavePeriod(hire, "2028-08-16")!;
    expect(third.yearIndex).toBe(3);
    expect(third.granted).toBe(16);
    expect(leavePeriodLabel(third)).toBe("2028-08-16 ~ 2029-08-15");
  });
});

describe("기준일(today)이 1년 미만 적립을 정하는 방식", () => {
  const hire = "2026-01-01";

  it("앞당겨 신청하면 그 날 기준으로 쌓일 연차까지 인정", () => {
    // 오늘은 3/1(2개월)인데 6/1 휴가를 신청 → 6/1엔 5개가 있다.
    const p = resolveLeavePeriod(hire, "2026-06-01", "2026-03-01")!;
    expect(p.granted).toBe(5);
  });

  it("지난 날짜를 조회하면 그 시점 이후 적립(오늘 기준)까지 인정", () => {
    // 오늘 6/1, 2/10 휴가를 소급 조회 → 같은 구간이라 오늘까지의 적립(5개)을 본다.
    const p = resolveLeavePeriod(hire, "2026-02-10", "2026-06-01")!;
    expect(p.granted).toBe(5);
  });

  it("지난 구간은 그 구간 끝 기준으로 만액", () => {
    const p = resolveLeavePeriod(hire, "2026-05-01", "2027-05-01")!;
    expect(p.yearIndex).toBe(0);
    expect(p.granted).toBe(11);
    expect(p.end).toBe("2026-12-31");
  });
});

describe("입사일이 없거나 형식이 틀리면 계산하지 않는다", () => {
  it.each([null, undefined, "", "2026-13-01", "not-a-date"])("%s → null", (hire) => {
    expect(resolveLeavePeriod(hire as string | null, "2026-08-14")).toBeNull();
  });
});
