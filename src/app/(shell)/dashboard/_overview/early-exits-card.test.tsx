import type { ReactNode } from "react";
import { render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { OverviewData } from "@/features/dashboard/overview/model";
vi.mock("@/components/workspace/window-link", () => ({
  WindowLink: ({ href, ariaLabel, children }: { href: string; ariaLabel?: string; children: ReactNode }) => (
    <a href={href} aria-label={ariaLabel}>
      {children}
    </a>
  ),
}));
import { EarlyExitsBody } from "./early-exits-card";

const row = (id: string, name: string, days: number | null) => ({
  id,
  name,
  schoolGrade: null,
  enrolledAt: "2026-07-01",
  withdrawnAt: "2026-10-10",
  days,
  subjects: ["math"],
});

it("세 칸은 누적 · 퇴원관리의 같은 필터로 가고, 명단은 빨리 그만둔 순 · 90일 넘은 퇴원은 빠진다(원장 2026-10-15)", () => {
  const data: OverviewData["earlyExits"] = {
    month: "2026-10",
    months: ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"],
    rows: [row("a", "가", 50), row("b", "나", 12), row("c", "다", 200), row("d", "라", null)],
    history: [
      { month: "2026-09", days: 20, subjects: [] },
      { month: "2026-09", days: 95, subjects: [] },
      { month: "2026-07", days: 88, subjects: [] },
    ],
  };
  render(<EarlyExitsBody data={data} />);
  expect(screen.getByRole("link", { name: /1개월 이내 퇴원 1명/ })).toHaveAttribute(
    "href",
    "/withdrawals?type=withdrawn&range=month&month=2026-10&early=1m",
  );
  expect(screen.getByRole("link", { name: /2개월 이내 퇴원 2명/ })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /3개월 이내 퇴원 2명/ })).toBeInTheDocument();
  expect(screen.getByText("이번 달 퇴원 4명 중 · 등록일로 판정할 수 없는 1명 제외")).toBeInTheDocument();
  const names = screen.getAllByRole("link", { name: /퇴원 상세/ }).map((a) => a.getAttribute("href"));
  expect(names).toEqual(["/withdrawals/b", "/withdrawals/a"]);
  const months = within(screen.getByLabelText("달마다 등록 후 3개월 이내 퇴원")).getAllByRole("listitem");
  expect(months.map((li) => li.textContent)).toEqual(["5월0", "6월0", "7월1", "8월0", "9월1", "10월2"]);
});

it("과목 관리자 화면은 담당 과목으로 좁힌 수라고 밝힌다 — 퇴원관리 목록은 학원 전체(리뷰 2026-10-15)", () => {
  render(
    <EarlyExitsBody
      data={{ month: "2026-10", months: ["2026-10"], rows: [row("b", "나", 12)], history: [] }}
      scope="수학"
    />,
  );
  expect(screen.getByText("이번 달 퇴원 1명 중 · 수학 과목만 (퇴원관리 목록은 학원 전체)")).toBeInTheDocument();
});

it("이번 달에 없으면 없다고 말한다", () => {
  render(
    <EarlyExitsBody
      data={{ month: "2026-10", months: ["2026-10"], rows: [row("c", "다", 200)], history: [] }}
    />,
  );
  expect(screen.getByText("이번 달에는 등록 후 3개월 안에 퇴원한 학생이 없습니다.")).toBeInTheDocument();
});
