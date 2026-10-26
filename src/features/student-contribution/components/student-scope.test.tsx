import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EmbedProvider } from "@/components/workspace/embed-context";
const m = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => m, useSearchParams: () => new URLSearchParams(window.location.search) }));
import { StudentContributionScope, ContributionLink } from "./student-contribution-scope";
import { useContributionListState } from "./use-contribution-list-state";
afterEach(() => { cleanup(); vi.clearAllMocks(); });
function Filter() { const [, update] = useContributionListState(); return <button onClick={() => update({ period: 3, direction: "asc" })}>필터</button>; }
it("창 안의 내부 링크·월 이동과 로컬 필터가 학생 경로를 유지한다", () => {
  window.history.replaceState(null, "", "/students/s?tab=contribution&contribution=list&embed=1");
  render(<EmbedProvider embed><StudentContributionScope studentId="s"><ContributionLink href="/student-contribution/s?month=2026-09&view=evidence">9월 근거</ContributionLink><Filter /></StudentContributionScope></EmbedProvider>);
  fireEvent.click(screen.getByRole("link", { name: "9월 근거" }));
  expect(m.push).toHaveBeenCalledWith("/students/s?month=2026-09&view=evidence&tab=contribution&embed=1", { scroll: false });
  fireEvent.click(screen.getByRole("button", { name: "필터" }));
  expect(window.location.pathname).toBe("/students/s");
  expect(Object.fromEntries(new URLSearchParams(window.location.search))).toMatchObject({ tab: "contribution", contribution: "list", period: "3", direction: "asc", embed: "1" });
});
