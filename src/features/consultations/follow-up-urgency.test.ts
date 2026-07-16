import { afterEach, describe, expect, it, vi } from "vitest";
import { addIsoDateDays, followUpUrgency } from "./follow-up-urgency";

describe("followUpUrgency", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("완료 및 날짜 없음 상태를 우선 처리한다", () => {
    expect(followUpUrgency("2026-07-01", true, "2026-07-16")).toBe("done");
    expect(followUpUrgency(null, false, "2026-07-16")).toBe("none");
  });

  it("KST 달력 날짜로 overdue/today/soon/later 경계를 구분한다", () => {
    const today = "2026-07-16";

    expect(followUpUrgency("2026-07-15", false, today)).toBe("overdue");
    expect(followUpUrgency("2026-07-16", false, today)).toBe("today");
    expect(followUpUrgency("2026-07-17", false, today)).toBe("soon");
    expect(followUpUrgency("2026-07-19", false, today)).toBe("soon");
    expect(followUpUrgency("2026-07-20", false, today)).toBe("later");
  });

  it("UTC 서버 날짜가 전날이어도 KST 자정부터 새 날짜로 판정한다", () => {
    vi.stubEnv("TZ", "UTC");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T15:00:00.000Z")); // 2026-07-16 00:00 KST

    expect(new Date().getHours()).toBe(15); // 서버 로컬 시각은 아직 7월 15일 15시

    expect(followUpUrgency("2026-07-15", false)).toBe("overdue");
    expect(followUpUrgency("2026-07-16", false)).toBe("today");
    expect(followUpUrgency("2026-07-19", false)).toBe("soon");
    expect(followUpUrgency("2026-07-20", false)).toBe("later");
  });

  it("KST 자정 직전에는 당일 판정을 유지한다", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T14:59:59.999Z")); // 2026-07-15 23:59 KST

    expect(followUpUrgency("2026-07-15", false)).toBe("today");
    expect(followUpUrgency("2026-07-18", false)).toBe("soon");
    expect(followUpUrgency("2026-07-19", false)).toBe("later");
  });

  it("월말·연말·윤년에도 3일 경계를 달력 기준으로 계산한다", () => {
    expect(addIsoDateDays("2026-07-31", 3)).toBe("2026-08-03");
    expect(addIsoDateDays("2026-12-31", 3)).toBe("2027-01-03");
    expect(addIsoDateDays("2028-02-28", 1)).toBe("2028-02-29");
  });
});
