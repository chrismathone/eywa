import { expect, it } from "vitest";
import { SALARY_GROUPS, type GroupRates } from "@/features/payroll/salary-group";
import { teacherCompSummary } from "./teacher-comp-summary";

const allGroups = Object.fromEntries(SALARY_GROUPS.map((group) => [group, 40])) as GroupRates;

it("keeps a numeric rate, including zero, and never prints a question mark", () => {
  expect(teacherCompSummary({ salaryType: "commission", commissionRate: 45, monthlyBase: 0, groupRates: { 초등: 10 } })).toEqual({
    text: "비율제 45%",
    groupSpan: "· 과정별 1",
  });
  expect(teacherCompSummary({ salaryType: "commission", commissionRate: 0, monthlyBase: 0 }).text).toBe("비율제 0%");
  expect(teacherCompSummary({ salaryType: "hybrid", commissionRate: 12, monthlyBase: 1000 }).text).toBe("혼합 1,000원+12%");
  expect(JSON.stringify(teacherCompSummary({ salaryType: "commission", commissionRate: null, monthlyBase: 0 }))).not.toContain("?");
});

it("says the default rate is unset unless every course rate replaces it", () => {
  expect(teacherCompSummary({ salaryType: "commission", commissionRate: null, monthlyBase: 0, groupRates: { 초등: 10, 중등: 0 } })).toEqual({
    text: "비율제 · 기본 비율 미설정",
    groupSpan: "· 과정별 2",
  });
  expect(teacherCompSummary({ salaryType: "commission", commissionRate: null, monthlyBase: 0, groupRates: allGroups })).toEqual({
    text: "비율제 · 과정별 5",
    groupSpan: null,
  });
  expect(teacherCompSummary({ salaryType: "hybrid", commissionRate: null, monthlyBase: 2000, groupRates: allGroups }).text).toBe(
    "혼합 2,000원 · 과정별 5",
  );
  expect(teacherCompSummary({ salaryType: "commission", commissionRate: null, monthlyBase: 0 }).groupSpan).toBeNull();
});

it("leaves an unset salary type and a fixed salary alone", () => {
  expect(teacherCompSummary({ salaryType: null, commissionRate: null, monthlyBase: 0, groupRates: { 특강: 5 } })).toEqual({
    text: "미설정",
    groupSpan: "· 과정별 1",
  });
  expect(teacherCompSummary({ salaryType: "fixed", commissionRate: null, monthlyBase: 3000, groupRates: { 고등: 8 } })).toEqual({
    text: "급여제 3,000원",
    groupSpan: "· 과정별 1",
  });
});
