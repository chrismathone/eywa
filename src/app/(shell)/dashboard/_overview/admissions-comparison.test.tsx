import type { ReactNode } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { EnrollmentStats, MonthStat } from "@/features/enrollment/server/stats-queries";
import { AdmissionsComparison } from "./admissions-comparison";

vi.mock("@/components/workspace/window-link", () => ({ WindowLink: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
afterEach(cleanup);
const month = (month: string, total: number, enrolled: number): MonthStat => ({ month, total, enrolled, open: total - enrolled, declined: 0, noShow: 0, paidSum: 0, rate: total ? enrolled / total * 100 : null });
const stats = (months: MonthStat[]): EnrollmentStats => ({ months, prevYearMonths: [], paths: [], total: 1000, enrolled: 900, rate: 90, paidSum: 0 });

it("연간 값이 남은 스냅샷도 지난달과 이번 달만 그리고 링크도 해당 월로 간다", () => {
  render(<AdmissionsComparison today="2026-09-12" stats={stats([month("2026-01", 999, 999), month("2026-08", 10, 4), month("2026-09", 2, 1), month("2026-10", 6, 6)])} />);
  expect(screen.getByText("40%")).toBeTruthy();
  expect(screen.getByText("50%")).toBeTruthy();
  expect(screen.queryByText("90%")).toBeNull();
  const table = screen.getByRole("table");
  expect(within(table).getByText("10건")).toBeTruthy();
  expect(screen.getByRole("link", { name: "8월 접수 보기" }).getAttribute("href")).toBe("/enrollment?view=table&month=2026-08");
  expect(screen.queryByText("999건")).toBeNull();
});

it("없는 달은 조회 확인 필요이고 성공한 0건은 전환율 없음이다", () => {
  render(<AdmissionsComparison today="2026-01-03" stats={stats([month("2026-01", 0, 0)])} />);
  expect(screen.getByText("조회 확인 필요")).toBeTruthy();
  expect(screen.queryByText("0%")).toBeNull();
  expect(screen.getByRole("link", { name: "12월 접수 보기" }).getAttribute("href")).toContain("2025-12");
});
