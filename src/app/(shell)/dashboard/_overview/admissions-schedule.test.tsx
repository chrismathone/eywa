import type { ReactNode } from "react";
import { render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { OverviewData } from "@/features/dashboard/overview/model";
vi.mock("@/components/workspace/window-link", () => ({
  WindowLink: ({ href, ariaLabel, children }: { href: string; ariaLabel?: string; children: ReactNode }) => <a href={href} aria-label={ariaLabel}>{children}</a>,
}));
import { AdmissionsSchedule } from "./admissions-schedule";

it("입테가 많아도 첫 수업이 보이며, 각 열의 제한과 상세 링크를 유지한다", () => {
  const tests: OverviewData["calendar"] = Array.from({ length: 5 }, (_, i) => ({
    id: `test-${i}`, title: `입테 ${i}`, startDate: "2026-09-22", endDate: "2026-09-22", startTime: "15:00", source: "manual", kind: "levelTest",
  }));
  render(<AdmissionsSchedule limit={3} events={[...tests, {
    id: "first", title: "수학 첫 수업", startDate: "2026-10-01", endDate: "2026-10-01", startTime: "14:00", source: "manual", kind: "firstClass",
    matchedClass: { id: "math-class", name: "수학반" },
  }]} />);
  const left = screen.getByRole("region", { name: "입학 테스트" });
  const right = screen.getByRole("region", { name: "첫 수업" });
  expect(within(left).getByText("5건")).toBeInTheDocument();
  expect(within(left).queryByText("입테 3")).not.toBeInTheDocument();
  expect(within(left).getByText("외 2건")).toBeInTheDocument();
  expect(within(right).getByRole("link", { name: /수학 첫 수업/ })).toHaveAttribute("href", "/classes/math-class");
  expect(within(right).queryByText("입테 0")).not.toBeInTheDocument();
});

it("취소된 일정은 시간 순서 그대로 취소선·'취소' 표식으로 남고, 열 건수엔 안 들고 링크도 없다(2026-09-30)", () => {
  render(<AdmissionsSchedule events={[
    { id: "a", title: "영어입테 김하늘", startDate: "2026-09-30", endDate: "2026-09-30", startTime: "14:00", source: "manual", kind: "levelTest" },
    {
      id: "x", title: "[취소] 수학입테 우다인", startDate: "2026-09-30", endDate: "2026-09-30", startTime: "15:00", source: "manual",
      kind: null, cancelledKind: "levelTest", matchedClass: null, matchedConsultation: null,
    },
    { id: "b", title: "영어입테 박지율", startDate: "2026-09-30", endDate: "2026-09-30", startTime: "16:00", source: "manual", kind: "levelTest" },
  ]} />);
  const left = screen.getByRole("region", { name: "입학 테스트" });
  expect(within(left).getByText("2건 · 취소 1")).toBeInTheDocument();
  const struck = within(left).getByText("[취소] 수학입테 우다인");
  expect(struck.className).toMatch(/eventCancelled/);
  expect(struck.closest("a")).toBeNull();
  const order = within(left).getAllByText(/입테/).map((el) => el.textContent);
  expect(order).toEqual(["영어입테 김하늘", "[취소] 수학입테 우다인", "영어입테 박지율"]);
  const mark = within(left).getByText("취소");
  expect(mark.getAttribute("data-tip")).toContain("취소된 일정");
  expect(mark.getAttribute("title")).toBeNull();
});
