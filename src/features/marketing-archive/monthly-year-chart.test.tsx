import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { blankEvent, type EventRow } from "./model";
import { monthlyYearSeries, MonthlyYearChart } from "./monthly-year-chart";

const row = (values: Partial<EventRow["document"]>): EventRow => ({ id: crypto.randomUUID(), version: 1, updated_at: "2026-11-10", document: { ...blankEvent(), title: "행사", ...values } });
describe("monthly event counts by year", () => {
  it("keeps years separate, uses month-only records, and excludes conflicts and other years", () => {
    const events = [row({ date: "2023-02-01" }), row({ date: "2023-02-15" }), row({ period: "2024-02" }), row({ date: "2025-07-10" }), row({ date: "2026-02-01" }), row({ period: "2026-11" }), row({ date: "2027-02-01" }), row({ date: "2025-02-05", raw: { "설명회명 및 날짜": "240207 설명회" } }), row({})];
    const result = monthlyYearSeries(events);
    expect(result.map(r => r.year)).toEqual([2023, 2024, 2025, 2026]);
    expect(result.map(r => r.months[1])).toEqual([2, 1, 0, 1]);
    expect(result[2].months[6]).toBe(1);
    expect(result[3].months[10]).toBe(1);
    expect(result.map(r => r.months.reduce((a, b) => a + b, 0))).toEqual([2, 1, 1, 2]);
  });
  it("labels all four years and twelve months even when records are empty", () => {
    render(<MonthlyYearChart events={[]} />);
    expect(screen.getByRole("img", { name: "2023년·2024년·2025년·2026년 월별 행사 기록 비교 막대그래프" })).toBeInTheDocument();
    for (const year of [2023, 2024, 2025, 2026]) expect(screen.getByText(`${year}년`)).toBeInTheDocument();
    expect(screen.getByText("1월")).toBeInTheDocument();
    expect(screen.getByText("12월")).toBeInTheDocument();
  });
});
