import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
const m = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => m, useSearchParams: () => new URLSearchParams("embed=1") }));
vi.mock("@/components/embed-link", () => ({ EmbedLink: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock("./contribution-shell", () => ({ ContributionHeader: () => <h1>학생 기록 연결</h1> }));
import { DEFAULT_STUDENT_FILTERS } from "../model/student-filters";
const filterOptions = { grades: ["초4"], subjects: [{ key: "math", label: "수학" }] };
import { CurrentScopeExplorer } from "./current-scope-explorer";
import { LIVE_SCOPE_VERSION, type LiveScopeData, type LiveScopeRequest } from "@/features/students/ontology/live-scope";
const request: LiveScopeRequest = { ...DEFAULT_STUDENT_FILTERS, kind: "class", id: "c", page: 2, search: "김" };
const data: LiveScopeData = { version: LIVE_SCOPE_VERSION, asOf: "2026-10-23", checkedAt: "2026-10-23T00:00:00Z",
  total: 25, filteredTotal: 25, classCount: 1, teacherCount: 1, subjectCount: 1, unassignedClasses: 0, unresolvedAssignments: 0,
  page: 2, pageSize: 20, students: [], connections: [], options: [
    { kind: "class", id: "c", label: "수학 A", students: 25 }, { kind: "teacher", id: "t", label: "담당 강사", students: 25 },
  ] };
beforeEach(() => vi.clearAllMocks()); afterEach(cleanup);
it("keeps cohort filters when changing perspective or selecting a student", () => {
  const directoryRequest: LiveScopeRequest = { ...DEFAULT_STUDENT_FILTERS, status: "on_hold", grade: "초4", subject: "math", kind: "student", id: "", search: "달산", page: 1 };
  const options = [{ kind: "student" as const, id: "second", label: "이학생", students: 1, detail: "달산초4" }];
  const view = { data: { ...data, options }, request: directoryRequest, state: "ready" as const, selectionMissing: false, canConfigure: false, filterOptions };
  const { rerender } = render(<CurrentScopeExplorer embed view={view} />);
  expect(screen.getByRole("region", { name: "학생 목록" })).toBeTruthy();
  expect(screen.queryByRole("textbox", { name: "학생 목록 검색" })).toBeNull();
  expect((screen.getByRole("combobox", { name: "재원 상태" }) as HTMLSelectElement).value).toBe("on_hold");
  fireEvent.click(screen.getByRole("button", { name: "이학생 · 달산초4 연결 보기" }));
  let params = new URL(m.push.mock.lastCall?.[0], "http://local.test").searchParams;
  expect(Object.fromEntries(params)).toMatchObject({ view: "current", kind: "student", entity: "second", embed: "1", status: "on_hold", grade: "초4", subject: "math", q: "달산" });
  rerender(<CurrentScopeExplorer embed view={{ ...view, request: { ...directoryRequest, id: "second" } }} />);
  expect(screen.queryByRole("region", { name: "학생 목록" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "학생 목록으로" }));
  params = new URL(m.push.mock.lastCall?.[0], "http://local.test").searchParams;
  expect(params.get("entity")).toBe(""); expect(params.get("q")).toBe("달산");
  fireEvent.click(screen.getByRole("button", { name: "강사" }));
  params = new URL(m.push.mock.lastCall?.[0], "http://local.test").searchParams;
  expect(params.get("kind")).toBe("teacher"); expect(params.get("status")).toBe("on_hold"); expect(params.get("subject")).toBe("math");
});
it("preserves selected scope and search in server pagination", () => {
  render(<CurrentScopeExplorer embed view={{ filterOptions, request, data, state: "ready", selectionMissing: false, canConfigure: false }} />);
  const previous = screen.getByRole("link", { name: "이전" });
  expect(new URL(previous.getAttribute("href")!, "http://local.test").searchParams.get("q")).toBe("김");
  expect(previous.getAttribute("href")).toContain("entity=c"); expect(previous.getAttribute("href")).toContain("embed=1");
  expect(screen.queryByRole("link", { name: "다음" })).toBeNull();
});
it("makes missing setup visible without zero totals and actually refreshes on retry", () => {
  render(<CurrentScopeExplorer embed view={{ filterOptions, request, data: null, state: "schema_missing", selectionMissing: false, canConfigure: false }} />);
  expect(screen.getByRole("status").textContent).toContain("현재 연결 조회 준비 중");
  expect(screen.queryByText("연결된 학생")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "다시 조회" })); expect(m.refresh).toHaveBeenCalledOnce();
});
it("links real enrollment evidence and distinguishes assignment roles from teaching outcomes", () => {
  const populated: LiveScopeData = { ...data, students: [{ id: "s", name: "학생 A", school: "학교", grade: "초1", classes: [{
    id: "c", name: "수학 A", subject: "math", onHold: true, enrollmentIds: ["e1", "e2"], teachers: [
      { role: "homeroom", teacherId: "t", name: "강사 A", sourceId: "c" },
      { role: "scheduledTeacher", teacherId: "t", name: "강사 A", sourceId: "schedule" },
    ],
  }] }], connections: [{ kind: "teacher", id: "t", label: "강사 A", students: 25 }] };
  render(<CurrentScopeExplorer embed view={{ filterOptions, request, data: populated, state: "ready", selectionMissing: false, canConfigure: false }} />);
  expect(screen.getByText("수강 근거 2건")).toBeTruthy(); expect(screen.getByText("휴원")).toBeTruthy();
  expect(screen.getByText(/담당 배정은 실제 수업 실시나 강사 성과/)).toBeTruthy();
  expect(screen.getByText("학생의 수강 원본 보기").getAttribute("href")).toBe("/students/s?tab=classes");
  expect(screen.getByRole("link", { name: "강사 A 25명" }).getAttribute("href")).toContain("kind=teacher&entity=t");
});
