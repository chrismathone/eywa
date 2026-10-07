import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MasterStudent, UnitsMaster } from "@/features/attendance/units-master";
import { UnitsMasterSheet } from "./sheet";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/embed-link", () => ({ EmbedLink: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a> }));

const student = (id: string, extra: Partial<MasterStudent>): MasterStudent => ({ id, name: id, school: "학교 중1", target: 2, invoice: "ok", actual: 1, future: 1, missing: 0, remaining: 1, review: [], owners: { t: { actual: 1, planned: 2 } }, events: [], status: "normal", ...extra });
const data: UnitsMaster = { month: "2026-10", asOf: "2026-10-07T14:00", classes: [
  { id: "math", name: "수학반", subject: "math", track: "math", from: "2026-10-02", to: "2026-11-02", periodLabel: "10월 수학 세션", teachers: [{ id: "t", name: "강사" }], students: [student("가학생", {}), student("나학생", { target: null, remaining: null, missing: 0.5, status: "unconfirmed" })] },
  { id: "english", name: "영어반", subject: "english", track: "hourly", from: "2026-10-01", to: "2026-11-02", periodLabel: "10월 영어 세션", teachers: [{ id: "t", name: "강사" }], students: [student("다학생", {})] },
] };

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    constructor(private callback: ResizeObserverCallback) {}
    observe() { this.callback([{ contentRect: { width: 1900 } }] as unknown as ResizeObserverEntry[], this as unknown as ResizeObserver); }
    disconnect() {}
  });
  vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("keeps unconfirmed students with missing attendance visible under input review and prioritizes them", () => {
  render(<UnitsMasterSheet data={data} initialSubject="math" />);
  const rows = document.querySelectorAll("[data-student-row]");
  expect(rows[0]).toHaveTextContent("나학생");
  expect(screen.queryByRole("button", { name: "다학생" })).toBeNull();
  const review = screen.getByRole("button", { name: /^입력 확인/ });
  expect(review).toHaveTextContent("1");
  fireEvent.click(review);
  expect(screen.getByRole("button", { name: "나학생" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "가학생" })).toBeNull();
});
it("opens an inline detail pane, navigates students, and keeps source links scoped to math", () => {
  render(<UnitsMasterSheet data={data} initialSubject="math" />);
  fireEvent.click(screen.getByRole("button", { name: "나학생" }));
  const pane = screen.getByRole("complementary", { name: "학생 시수 상세" });
  expect(within(pane).getByText(/월 발생 시수가 미확정/)).toBeInTheDocument();
  const href = within(pane).getByRole("link", { name: "원 출석부 열기" }).getAttribute("href")!;
  const url = new URL(href, "https://test.invalid");
  expect(url.searchParams.get("class")).toBe("math");
  expect(url.searchParams.get("subject")).toBe("math");
  expect(url.searchParams.get("month")).toBe("2026-10");
  fireEvent.click(within(pane).getByRole("button", { name: "다음 학생" }));
  expect(within(pane).getByRole("heading", { name: /가학생/ })).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(within(pane).getByRole("button", { name: "닫기" }));
  expect(screen.queryByRole("complementary")).toBeNull();
});
