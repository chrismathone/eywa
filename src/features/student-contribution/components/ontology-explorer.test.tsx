import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
const query = vi.hoisted(() => vi.fn());
vi.mock("../server/ontology-query", () => ({ getContributionOntology: query }));
vi.mock("../server/live-scope-query", () => ({ getCurrentOntologyScope: vi.fn() }));
vi.mock("./contribution-shell", () => ({ ContributionHeader: () => <h1>학생 기록 연결</h1> }));
vi.mock("./month-picker", () => ({ ContributionMonthPicker: () => null }));
vi.mock("./ontology-view-mode", () => ({ OntologyViewMode: () => null }));
vi.mock("@/components/embed-link", () => ({ EmbedLink: "a" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
import { DEFAULT_STUDENT_FILTERS } from "../model/student-filters";
import { OntologyExplorer } from "./ontology-explorer";
import OntologyPage from "@/app/(shell)/student-contribution/ontology/page";
afterEach(cleanup);

const empty = { students: [] as string[], counts: {}, factCount: 0, tuitionWon: 0, unallocatedTuitionFacts: 0, related: [], studentCounts: {}, basis: { recorded: 0, rule: 0, ai: 0 }, recordedAt: "" };
const data: ComponentProps<typeof OntologyExplorer>["data"] = {
  filters: DEFAULT_STUDENT_FILTERS, filterOptions: { grades: [], subjects: [] },
  tenant: "academy", month: "2026-10", canConfigure: false, historyReady: true, identityIssues: 0,
  labels: { student: [{ id: "first", label: "안도현", detail: "침산초4" }, { id: "second", label: "이학생", detail: "달산초5" }, { id: "empty", label: "무기록", detail: "침산초6" }],
    class: [{ id: "c", label: "수학 A" }], teacher: [{ id: "t", label: "선생님 A" }], subject: [{ id: "math", label: "수학" }], academy: [{ id: "academy", label: "학원 전체" }] },
  views: { "student:first": { ...empty, students: ["first"], factCount: 6, counts: { attendance: 6 }, studentCounts: { first: { attendance: 6 } } },
    "student:second": { ...empty, students: ["second"], factCount: 2, counts: { attendance: 2 }, studentCounts: { second: { attendance: 2 } } } },
};
it("shows eligible students including zero records and keeps the shared filters available in detail", () => {
  render(<OntologyExplorer data={data} />);
  fireEvent.click(screen.getByRole("button", { name: "학생" }));
  const list = screen.getByRole("region", { name: "학생 목록" });
  expect(within(list).getAllByRole("listitem")).toHaveLength(3);
  expect(within(list).getByRole("button", { name: "무기록 · 침산초6 · 이 달 연결 기록 0건 연결 보기" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "안도현" })).toBeNull();
  expect(screen.queryByRole("textbox", { name: "연결된 학생 검색" })).toBeNull();
  expect((screen.getByRole("combobox", { name: "재원 상태" }) as HTMLSelectElement).value).toBe("enrolled");
  expect(within(list).queryByRole("textbox")).toBeNull();
  fireEvent.click(within(list).getByRole("button", { name: /^이학생 .*연결 보기$/ }));
  expect(screen.getByRole("heading", { name: "이학생" })).toBeTruthy();
  expect(screen.queryByRole("region", { name: "학생 목록" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "학생 목록으로" }));
  expect(screen.getByRole("textbox", { name: "학생 이름·학교 검색" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /^무기록 .*연결 보기$/ }));
  expect(screen.getByRole("heading", { name: "무기록" })).toBeTruthy();
  expect(screen.getByText(/선택한 대상과 월에 연결된 기록이 없습니다/)).toBeTruthy();
});
it.each(["반", "강사", "과목"])("opens the %s directory rather than its first entry", (label) => {
  render(<OntologyExplorer data={data} />);
  fireEvent.click(within(screen.getByLabelText("연결 관점")).getByRole("button", { name: label }));
  expect(screen.getByRole("region", { name: `${label} 목록` })).toBeTruthy();
  expect(screen.queryByText("대상을 선택해 주세요")).toBeNull();
});
it("paginates twenty students at a time and keeps the page on returning from detail", () => {
  const students = Array.from({ length: 23 }, (_, i) => ({ id: `s${i}`, label: `학생${String(i).padStart(2, "0")}`, detail: "침산초4" }));
  render(<OntologyExplorer data={{ ...data, labels: { ...data.labels, student: students } }} />);
  fireEvent.click(screen.getByRole("button", { name: "학생" }));
  expect(within(screen.getByRole("region", { name: "학생 목록" })).getAllByRole("listitem")).toHaveLength(20);
  fireEvent.click(screen.getByRole("button", { name: "학생 목록 다음 페이지" }));
  expect(within(screen.getByRole("region", { name: "학생 목록" })).getAllByRole("listitem")).toHaveLength(3);
  fireEvent.click(screen.getByRole("button", { name: /^학생22 .*연결 보기$/ }));
  fireEvent.click(screen.getByRole("button", { name: "학생 목록으로" }));
  expect(screen.getByText("2 / 2")).toBeTruthy();
});
it("restores the URL perspective after changing month and navigating back", async () => {
  query.mockImplementation(async (month: string) => ({ ...data, month }));
  const original = { month: "2026-10" };
  const { rerender } = render(await OntologyPage({ searchParams: Promise.resolve(original) }));
  fireEvent.click(within(screen.getByLabelText("연결 관점")).getByRole("button", { name: "반" }));
  fireEvent.click(screen.getByRole("button", { name: /수학 A .*연결 보기/ }));
  expect(screen.getByRole("heading", { name: "수학 A" })).toBeTruthy();
  rerender(await OntologyPage({ searchParams: Promise.resolve({ month: "2026-09", kind: "class", entity: "c" }) }));
  expect(screen.getByRole("heading", { name: "수학 A" })).toBeTruthy();
  rerender(await OntologyPage({ searchParams: Promise.resolve(original) }));
  expect(within(screen.getByLabelText("연결 관점")).getByRole("button", { name: "학원" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("heading", { name: "학원 전체" })).toBeTruthy();
});
