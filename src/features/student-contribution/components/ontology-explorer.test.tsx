import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
vi.mock("./contribution-shell", () => ({ ContributionHeader: () => <h1>학생 기록 연결</h1> }));
vi.mock("./month-picker", () => ({ ContributionMonthPicker: () => null }));
vi.mock("./ontology-view-mode", () => ({ OntologyViewMode: () => null }));
vi.mock("@/components/embed-link", () => ({ EmbedLink: "a" }));
import { OntologyExplorer } from "./ontology-explorer";
afterEach(cleanup);

const empty = { students: [] as string[], counts: {}, factCount: 0, tuitionWon: 0, unallocatedTuitionFacts: 0, related: [], studentCounts: {}, basis: { recorded: 0, rule: 0, ai: 0 }, recordedAt: "" };
const data: ComponentProps<typeof OntologyExplorer>["data"] = {
  tenant: "academy", month: "2026-10", canConfigure: false, historyReady: true, identityIssues: 0,
  labels: { student: [{ id: "first", label: "안도현", detail: "침산초4" }, { id: "second", label: "이학생", detail: "달산초5" }, { id: "empty", label: "무기록", detail: "침산초6" }],
    class: [{ id: "c", label: "수학 A" }], teacher: [{ id: "t", label: "선생님 A" }], subject: [{ id: "math", label: "수학" }], academy: [{ id: "academy", label: "학원 전체" }] },
  views: { "student:first": { ...empty, students: ["first"], factCount: 6, counts: { attendance: 6 }, studentCounts: { first: { attendance: 6 } } },
    "student:second": { ...empty, students: ["second"], factCount: 2, counts: { attendance: 2 }, studentCounts: { second: { attendance: 2 } } } },
};
it("shows all students including zero records before selection and restores the searched list after detail", () => {
  render(<OntologyExplorer data={data} />);
  fireEvent.click(screen.getByRole("button", { name: "학생" }));
  const list = screen.getByRole("region", { name: "학생 목록" });
  expect(within(list).getAllByRole("row")).toHaveLength(4);
  expect(within(list).getByText("0건")).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "안도현" })).toBeNull();
  expect(screen.queryByRole("textbox", { name: "연결된 학생 검색" })).toBeNull();
  fireEvent.change(within(list).getByRole("textbox"), { target: { value: "달산" } });
  fireEvent.click(within(list).getByRole("button", { name: "이학생 연결 보기" }));
  expect(screen.getByRole("heading", { name: "이학생" })).toBeTruthy();
  expect(screen.queryByRole("region", { name: "학생 목록" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "학생 목록으로" }));
  expect((screen.getByRole("textbox", { name: "학생 목록 검색" }) as HTMLInputElement).value).toBe("달산");
  fireEvent.click(screen.getByRole("button", { name: "초기화" }));
  fireEvent.click(screen.getByRole("button", { name: "무기록 연결 보기" }));
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
  expect(within(screen.getByRole("region", { name: "학생 목록" })).getAllByRole("row")).toHaveLength(21);
  fireEvent.click(screen.getByRole("button", { name: "학생 목록 다음 페이지" }));
  expect(within(screen.getByRole("region", { name: "학생 목록" })).getAllByRole("row")).toHaveLength(4);
  fireEvent.click(screen.getByRole("button", { name: "학생22 연결 보기" }));
  fireEvent.click(screen.getByRole("button", { name: "학생 목록으로" }));
  expect(screen.getByText("2 / 2")).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox", { name: "학생 목록 검색" }), { target: { value: "학생00" } });
  expect(screen.getByText("1 / 1")).toBeTruthy();
  expect(screen.getByRole("button", { name: "학생00 연결 보기" })).toBeTruthy();
});
