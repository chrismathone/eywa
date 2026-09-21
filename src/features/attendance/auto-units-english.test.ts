import { describe, expect, it } from "vitest";
import { autoUnitsOn, unitsFromMinutes, usesFortyMinuteEnglishUnits, type AutoUnitsSchedule } from "./auto-units";

const lesson = (extra: Partial<AutoUnitsSchedule> = {}): AutoUnitsSchedule => ({
  dayOfWeek: "tue", startTime: "15:00", endTime: "15:40", validFrom: "2026-09-01", validTo: null,
  slotTeacherLabel: null, ...extra,
});

describe("영어 트랙 시수", () => {
  it("EiE는 40분당 1시수로 계산한다", () => {
    expect(unitsFromMinutes(40, "eie")).toBeNull();
    expect(unitsFromMinutes(60, "eie")).toBe(1.5);
    expect(unitsFromMinutes(80, "eie")).toBe(2);
    expect(unitsFromMinutes(120, "eie")).toBe(3);
  });

  it("인재원은 60분당 1시수다(수학의 0.5와 구분)", () => {
    expect(unitsFromMinutes(60, "injaewon")).toBeNull();
    expect(unitsFromMinutes(120, "injaewon")).toBe(2);
    expect(unitsFromMinutes(180, "injaewon")).toBe(3);
    expect(unitsFromMinutes(60, "math")).toBe(0.5);
  });

  it("반 이름에 브릿지가 없어도 다른 요일의 40분 수업이 있으면 60분은 1.5U다", () => {
    const schedules = [lesson(), lesson({ dayOfWeek: "wed", endTime: "16:00" })];
    expect(usesFortyMinuteEnglishUnits("2026-09-09", schedules, "injaewon", "중등E_초5 MED")).toBe(true);
    expect(autoUnitsOn("2026-09-09", schedules, "injaewon", "중등E_초5 MED")).toBe(1.5);
    expect(autoUnitsOn("2026-09-09", schedules, "math")).toBe(0.5);
  });

  it("만료·미시작 교시와 *LAB만으로 브릿지 판정을 바꾸지 않는다", () => {
    const schedules = [lesson({ validTo: "2026-09-08" }), lesson({ validFrom: "2026-09-10" }),
      lesson({ slotTeacherLabel: "LAB", labSeparate: true }), lesson({ slotTeacherLabel: "*LAB" }),
      lesson({ dayOfWeek: "wed", endTime: "16:00" })];
    expect(usesFortyMinuteEnglishUnits("2026-09-09", schedules, "injaewon", "중등E 정규")).toBe(false);
    expect(autoUnitsOn("2026-09-09", schedules, "injaewon")).toBeNull();
  });

  it("같은 2시간 수업료 24,000원을 과목별 U 단위로만 다르게 표현한다", () => {
    expect((unitsFromMinutes(120, "math") ?? 1) * 24000).toBe(24000);
    expect((unitsFromMinutes(120, "injaewon") ?? 1) * 12000).toBe(24000);
    expect((unitsFromMinutes(120, "eie") ?? 1) * 8000).toBe(24000);
  });
});
