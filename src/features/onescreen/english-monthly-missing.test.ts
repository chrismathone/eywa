import { describe, expect, it } from "vitest";
import { monthlyScoresMissing, type EnglishRowFacts } from "./english-draft";
import { BUILTIN_EIE_DAILY_TEMPLATE, BUILTIN_EIE_MONTHLY_TEMPLATE } from "@/features/report-templates/defaults";

const facts: EnglishRowFacts = { studentName: "a", teacherName: "", progress: "", homeworkToday: "", dailyTest: "", checkTest: "", attitude: "", homework: "", note: "코멘트" };
const ev = { month: "2026-10", areaMax: 25, areas: { writing: { score: 1, average: 1 }, speaking: { score: 1, average: 1 }, reading: { score: 1, average: 1 }, listening: { score: 1, average: 1 } } };

describe("monthlyScoresMissing", () => {
  it("월간 템플릿 + 점수 없음일 때만 알린다", () => {
    expect(monthlyScoresMissing(BUILTIN_EIE_MONTHLY_TEMPLATE, facts)).toBe(true);
    expect(monthlyScoresMissing(BUILTIN_EIE_MONTHLY_TEMPLATE, { ...facts, monthly: ev })).toBe(false);
    expect(monthlyScoresMissing(BUILTIN_EIE_DAILY_TEMPLATE, facts)).toBe(false);
  });
});
