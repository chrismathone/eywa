import { describe, it, expect } from "vitest";
import {
  deriveMarksFromReports,
  isDerivedAttendanceSubject,
} from "./derive-from-reports";

const TODAY = "2026-07-21";
const base = {
  attendDates: [] as string[],
  reportDates: new Set<string>(),
  manualDates: new Set<string>(),
  today: TODAY,
};

describe("isDerivedAttendanceSubject", () => {
  it("수학만 파생 — 영어는 출석부 미가동이라 제외", () => {
    expect(isDerivedAttendanceSubject("math")).toBe(true);
    expect(isDerivedAttendanceSubject("english")).toBe(false);
    expect(isDerivedAttendanceSubject(null)).toBe(false);
    expect(isDerivedAttendanceSubject("")).toBe(false);
  });
});

describe("deriveMarksFromReports", () => {
  it("보고서 있으면 출석(1)", () => {
    expect(
      deriveMarksFromReports({
        ...base,
        attendDates: ["2026-07-14", "2026-07-17"],
        reportDates: new Set(["2026-07-14", "2026-07-17"]),
      }),
    ).toEqual({ "2026-07-14": "present", "2026-07-17": "present" });
  });

  it("등원일인데 보고서 없으면 결석(0)", () => {
    expect(
      deriveMarksFromReports({ ...base, attendDates: ["2026-07-14", "2026-07-17"], reportDates: new Set(["2026-07-14"]) }),
    ).toEqual({ "2026-07-14": "present", "2026-07-17": "absent" });
  });

  it("등원일이 아닌 날은 아무 판정도 안 한다", () => {
    // attendDates에 없는 날짜는 애초에 후보가 아니다(호출부가 eligibility로 걸러 넘긴다).
    const out = deriveMarksFromReports({ ...base, attendDates: ["2026-07-14"], reportDates: new Set() });
    expect(Object.keys(out)).toEqual(["2026-07-14"]);
  });

  // ⚠️ 이 가드가 없으면 이번 달 남은 날이 전부 결석으로 찍힌다.
  it("오늘·미래는 보고서가 없어도 결석으로 찍지 않는다", () => {
    expect(
      deriveMarksFromReports({ ...base, attendDates: ["2026-07-20", TODAY, "2026-07-24"], reportDates: new Set() }),
    ).toEqual({ "2026-07-20": "absent" });
  });

  it("오늘 보고서가 이미 있으면 출석으로 찍는다", () => {
    expect(
      deriveMarksFromReports({ ...base, attendDates: [TODAY], reportDates: new Set([TODAY]) }),
    ).toEqual({ [TODAY]: "present" });
  });

  it("수기 기록이 있는 날은 파생하지 않는다 — 사람이 적은 게 이긴다", () => {
    const out = deriveMarksFromReports({
      ...base,
      attendDates: ["2026-07-14", "2026-07-17"],
      reportDates: new Set(["2026-07-14"]),
      manualDates: new Set(["2026-07-14", "2026-07-17"]),
    });
    expect(out).toEqual({});
  });

  it("수기·보고서가 섞여도 수기 날짜만 비켜간다", () => {
    const out = deriveMarksFromReports({
      ...base,
      attendDates: ["2026-07-13", "2026-07-14", "2026-07-17"],
      reportDates: new Set(["2026-07-13"]),
      manualDates: new Set(["2026-07-14"]),
    });
    expect(out).toEqual({ "2026-07-13": "present", "2026-07-17": "absent" });
  });

  it("등원일이 없으면 빈 결과", () => {
    expect(deriveMarksFromReports({ ...base, reportDates: new Set(["2026-07-14"]) })).toEqual({});
  });
});
