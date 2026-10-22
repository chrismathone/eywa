import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SchoolBar } from "@/features/enrollment/consultation-dist";
import { DEFAULT_SCHOOL_PREFS } from "@/features/enrollment/school-view-prefs";

vi.mock("@/features/enrollment/server/school-prefs-actions", () => ({ saveSchoolStatsPrefs: vi.fn(async () => ({})) }));
import { ConsultDistPanel } from "./consult-dist-panel";

const school = (key: string, n: number, kind: SchoolBar["kind"] = "초"): SchoolBar => ({
  key, label: key, officialName: null, kind, n, enrolled: 1, total: null, rate: null,
});
const rows = [
  ...Array.from({ length: 8 }, (_, i) => school(`주요${i + 1}초`, 20 - i)),
  school("소수A초", 1), school("소수B중", 2, "중"), school("기타 (학교 미상)", 3, null),
];
const panel = () => <ConsultDistPanel rows={rows} initial={DEFAULT_SCHOOL_PREFS} year={null} hasTotals={false} totalsYear={null} />;
afterEach(cleanup);

describe("학교 상담 요약과 전체 보기", () => {
  it("접힌 화면에서도 기타 합산을 보여주고 클릭하면 개별 학교를 확인할 수 있다", () => {
    render(panel());
    const region = screen.getByRole("region", { name: "학교별 상담 분포" });
    expect(screen.getByText(/전체 기간 상담 138건 · 등록 11건/)).toBeInTheDocument();
    expect(within(region).getAllByRole("listitem")).toHaveLength(6);
    expect(screen.queryByText("소수A초")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /기타 \(2건 이하 학교\) · 2곳/ }));
    expect(screen.getByText("소수A초")).toBeInTheDocument();
    expect(screen.getByText("소수B중")).toBeInTheDocument();
  });

  it("전체 보기와 접기를 제공하며 학교급 필터 뒤에도 숨겨진 학교의 건수를 유지한다", () => {
    render(panel());
    const expand = screen.getByRole("button", { name: "전체 10개 항목 보기" });
    fireEvent.click(expand);
    expect(expand).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("주요8초")).toBeInTheDocument();
    expect(screen.getByText("기타 (학교 미상)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "접기" }));
    expect(screen.queryByText("주요8초")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "중" }));
    fireEvent.click(screen.getByRole("button", { name: "고" }));
    expect(screen.getByText(/전체 기간 상담 133건 · 등록 9건/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /기타 \(2건 이하 학교\) · 1곳/ }));
    expect(screen.getByText("소수A초")).toBeInTheDocument();
    expect(screen.queryByText("소수B중")).toBeNull();
  });
});
