import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const m = vi.hoisted(() => ({ push: vi.fn(), query: "view=current&embed=1&page=8" }));
vi.mock("next/navigation", () => ({ useRouter: () => m, useSearchParams: () => new URLSearchParams(m.query), usePathname: () => "/student-contribution/ontology" }));
vi.mock("@/components/embed-link", () => ({ EmbedLink: "a" }));
import { DEFAULT_STUDENT_FILTERS } from "../model/student-filters";
import { OntologyFilters } from "./ontology-filters";
import { OntologyViewMode } from "./ontology-view-mode";
import { OntologyNavigation } from "./ontology-navigation";
import { ContributionMonthPicker } from "./month-picker";
const options = { grades: ["초4"], subjects: [{ key: "math", label: "수학" }] };
beforeEach(() => { vi.clearAllMocks(); m.query = "view=current&embed=1&page=8"; });
afterEach(cleanup);
const navigated = () => new URL(m.push.mock.lastCall![0], "https://local.test").searchParams;

it.each(["student", "class", "teacher", "subject", "academy"])("applies filters to %s and clears pagination without losing embed or month", (kind) => {
  m.query = "month=2026-09&embed=1&page=8";
  render(<OntologyFilters filters={DEFAULT_STUDENT_FILTERS} options={options} scope={{ kind, id: "chosen" }} />);
  fireEvent.change(screen.getByRole("combobox", { name: "재원 상태" }), { target: { value: "withdrawn" } });
  expect(Object.fromEntries(navigated())).toEqual({ month: "2026-09", embed: "1", kind, entity: "chosen", status: "withdrawn" });
});
it("submits search once instead of requesting on each keystroke, preserves filters and resets to enrolled", () => {
  render(<OntologyFilters filters={{ ...DEFAULT_STUDENT_FILTERS, status: "all", grade: "초4", subject: "math" }} options={options} scope={{ kind: "student", id: "" }} />);
  fireEvent.change(screen.getByRole("textbox", { name: "학생 이름·학교 검색" }), { target: { value: " 김 A&B " } });
  expect(m.push).not.toHaveBeenCalled();
  fireEvent.submit(screen.getByRole("form", { name: "학생 조회 필터" }));
  expect(Object.fromEntries(navigated())).toEqual({ view: "current", embed: "1", kind: "student", entity: "", q: "김 A&B", status: "all", grade: "초4", subject: "math" });
  fireEvent.click(screen.getByRole("button", { name: "초기화" }));
  expect(Object.fromEntries(navigated())).toEqual({ view: "current", embed: "1", kind: "student", entity: "", status: "enrolled" });
});
it("preserves the cohort in both current/monthly mode links", () => {
  m.query = "view=current&month=2026-09&embed=1";
  render(<OntologyViewMode current scope={{ kind: "class", id: "c" }} filters={{ search: "학생", status: "on_hold", grade: "초4", subject: "math" }} />);
  for (const link of screen.getAllByRole("link")) {
    expect(Object.fromEntries(new URL(link.getAttribute("href")!, "https://local.test").searchParams))
      .toMatchObject({ q: "학생", status: "on_hold", grade: "초4", subject: "math", month: "2026-09", kind: "class", entity: "c", embed: "1" });
  }
});
it("keeps the mobile filter panel open while applying successive conditions", () => {
  const view = render(<OntologyFilters filters={DEFAULT_STUDENT_FILTERS} options={options} scope={{ kind: "student", id: "" }} />);
  expect(screen.getByRole("button", { name: "필터 펼치기" }).getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "필터 펼치기" }));
  fireEvent.change(screen.getByRole("combobox", { name: "학년" }), { target: { value: "초4" } });
  expect(navigated().get("filters")).toBe("open");
  m.query = navigated().toString(); view.unmount();
  render(<OntologyFilters filters={{ ...DEFAULT_STUDENT_FILTERS, grade: "초4" }} options={options} scope={{ kind: "student", id: "" }} />);
  expect(screen.getByRole("button", { name: "필터 접기" }).getAttribute("aria-expanded")).toBe("true");
});
it("preserves the locally chosen monthly perspective when moving months", () => {
  m.query = "month=2026-10&status=on_hold&grade=초4&embed=1&page=3";
  render(<ContributionMonthPicker month="2026-10" scope={{ kind: "teacher", id: "t" }} />);
  fireEvent.change(screen.getByLabelText("기록 월"), { target: { value: "2026-09" } });
  expect(Object.fromEntries(navigated())).toEqual({ month: "2026-09", status: "on_hold", grade: "초4", embed: "1", kind: "teacher", entity: "t" });
});
it("blocks a competing navigation while a filter transition is pending", async () => {
  let finish!: () => void;
  m.push.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  const { container } = render(<OntologyNavigation>
    <OntologyFilters filters={DEFAULT_STUDENT_FILTERS} options={options} scope={{ kind: "student", id: "" }} />
    <OntologyViewMode current filters={DEFAULT_STUDENT_FILTERS} />
  </OntologyNavigation>);
  fireEvent.change(screen.getByRole("combobox", { name: "재원 상태" }), { target: { value: "all" } });
  await waitFor(() => expect(container.querySelector("[inert]")).toBeTruthy());
  fireEvent.click(screen.getByRole("link", { name: "월별 로열티 근거" }));
  expect(m.push).toHaveBeenCalledOnce();
  await act(async () => finish());
  await waitFor(() => expect(container.querySelector("[inert]")).toBeNull());
});
