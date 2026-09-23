import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GoalsTable } from "./goals-table";

const { upsertGoal, getEcsDayPlan, createLine, flushPatches, refresh } = vi.hoisted(() => ({
  upsertGoal: vi.fn(), getEcsDayPlan: vi.fn(), createLine: vi.fn(), flushPatches: vi.fn(), refresh: vi.fn(),
}));
vi.mock("@/components/workspace/use-in-frame", () => ({ useInFrame: () => true }));
vi.mock("@/components/workspace/use-is-desktop", () => ({ useIsDesktop: () => true }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/features/presence/editing-badge", () => ({ EditingBadge: () => null }));
vi.mock("@/features/presence/edit-presence", () => ({ useEditPresence: () => null }));
vi.mock("@/features/class-sheets/server/actions", () => ({ upsertGoal }));
vi.mock("@/features/class-sheets/server/day-plan", () => ({ getEcsDayPlan }));
vi.mock("@/features/class-sheets/components/plan-api", () => ({ ECS_PLAN_API: { createLine, flushPatches } }));
vi.mock("@/components/ui/drag-scroll-area", () => ({
  DragScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  upsertGoal.mockReset();
  getEcsDayPlan.mockReset();
  createLine.mockReset();
  flushPatches.mockReset();
  refresh.mockReset();
});

const slot = { slotStart: "15:00", slotEnd: "16:00", teacherLabel: null, roomLabel: null, seat: null };
const row = (withLesson = false) => ({
  classId: "class-1", className: "중등E_중1 MED", teacherName: null,
  hasLessonOnDate: withLesson, daySlots: withLesson ? [slot] : [],
  cells: [{ area: "vocab", state: "none" as const, month: [], week: [], day: [] }],
});
function renderTable(withLesson = false) {
  return render(<GoalsTable rows={[row(withLesson)]} areas={[{ key: "vocab", label: "Vocab" }]}
    weekMonday="2026-09-21" monthStart="2026-09-01" date="2026-09-23"
    lang="ko" role="homeroom" showDay canEdit teacherNames={{}} />);
}

describe("반 계획 보기의 반 링크", () => {
  it("창 안에서 Shift+클릭하면 브라우저 기본 새 창 대신 앱 작업면에 새 창을 요청한다", () => {
    const postMessage = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
    render(
      <GoalsTable
        rows={[{ classId: "class-1", className: "중등E_중1 MED", teacherName: null, hasLessonOnDate: true, daySlots: [], cells: [] }]}
        areas={[]}
        weekMonday="2026-09-21"
        monthStart="2026-09-01"
        date="2026-09-23"
        lang="ko"
        role="all"
        showDay
        canEdit
        teacherNames={{}}
      />,
    );

    const link = screen.getByRole("link", { name: "중등E_중1 MED" });
    expect(link.getAttribute("href")).toContain("/ecs/class-1?week=2026-09-21");
    expect(fireEvent.click(link, { shiftKey: true, button: 0, detail: 1 })).toBe(false);
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "eywa-open-window",
        href: "/ecs/class-1?week=2026-09-21",
        newInstance: true,
      }),
      window.location.origin,
    );
  });

  it("월·주 줄을 더블클릭하면 칸 안에서 직접 수정하고 기존 목표 저장 경로를 쓴다", async () => {
    upsertGoal.mockResolvedValue({ ok: true });
    const table = renderTable();
    fireEvent.doubleClick(screen.getByRole("button", { name: /Vocab · 월 · 더블클릭하여 수정/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
    const monthlyBook = screen.getByRole("textbox", { name: /담임.*교재/ });
    expect(table.container.contains(monthlyBook)).toBe(false);
    expect(monthlyBook.closest("[data-anchored-editor]")).not.toBeNull();
    expect(table.container.textContent).toContain("월비어 있음");
    fireEvent.change(monthlyBook, { target: { value: "능률보카" } });
    fireEvent.keyDown(monthlyBook, { key: "Enter" });
    await waitFor(() => expect(upsertGoal).toHaveBeenCalledWith(expect.objectContaining({
      classId: "class-1", skillArea: "vocab", scope: "month", periodStart: "2026-09-01",
      role: "homeroom", textbook: "능률보카",
    })));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));

    fireEvent.doubleClick(screen.getByRole("button", { name: /Vocab · 주 · 더블클릭하여 수정/ }));
    const weeklyBook = screen.getByRole("textbox", { name: /담임.*교재/ });
    fireEvent.change(weeklyBook, { target: { value: "주간 교재" } });
    fireEvent.keyDown(weeklyBook, { key: "Enter" });
    await waitFor(() => expect(upsertGoal).toHaveBeenCalledWith(expect.objectContaining({
      scope: "week", periodStart: "2026-09-21", textbook: "주간 교재",
    })));
    expect(screen.getByText("수업 없음").textContent).toBe("수업 없음");
    expect(screen.queryByRole("button", { name: /Vocab · 일 · 더블클릭하여 수정/ })).toBeNull();
  });

  it("일간 줄도 같은 칸에서 수정하고 기존 계획 CAS 저장 경로를 쓴다", async () => {
    getEcsDayPlan.mockResolvedValue({ ok: true, data: {
      canEdit: true, showExamTerm: false,
      linesBySlot: { "15:00": [{ id: "a1111111-1111-4111-8111-111111111111", planDate: "2026-09-23",
        slotStart: "15:00", termMode: "regular", skillArea: "vocab", lineNo: 1,
        textbook: "능률보카", pageRange: null, progress: "Day 1", homework: null, updatedAt: "2026-09-23" }] },
    } });
    flushPatches.mockResolvedValue({ ok: true, results: [{ saveKey: "a1111111-1111-4111-8111-111111111111:progress", status: "applied", clientRev: 1 }] });
    const table = renderTable(true);
    fireEvent.doubleClick(screen.getByRole("button", { name: /Vocab · 일 · 더블클릭하여 수정/ }));
    const progress = await screen.findByRole("textbox", { name: /일 15:00.*진도/ });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(table.container.contains(progress)).toBe(false);
    expect(table.container.textContent).toContain("일비어 있음");
    fireEvent.change(progress, { target: { value: "Day 2" } });
    fireEvent.keyDown(progress, { key: "Enter" });
    await waitFor(() => expect(flushPatches).toHaveBeenCalledWith(
      { classId: "class-1", planDate: "2026-09-23", slotStart: "15:00" },
      [expect.objectContaining({ field: "progress", expectedValue: "Day 1", newValue: "Day 2" })],
    ));
    expect(createLine).not.toHaveBeenCalled();
  });

  it("일간 계획이 비어 있어도 실제 수업 교시에는 새 줄을 만들어 수정한다", async () => {
    getEcsDayPlan.mockResolvedValue({ ok: true, data: { canEdit: true, showExamTerm: false, linesBySlot: {} } });
    createLine.mockResolvedValue({ ok: true, lines: [{ id: "b2222222-2222-4222-8222-222222222222", planDate: "2026-09-23",
      slotStart: "15:00", termMode: "regular", skillArea: "vocab", lineNo: 1,
      textbook: null, pageRange: null, progress: null, homework: null, updatedAt: "2026-09-23" }] });
    flushPatches.mockResolvedValue({ ok: true, results: [{ saveKey: "b2222222-2222-4222-8222-222222222222:textbook", status: "applied", clientRev: 1 }] });
    renderTable(true);
    fireEvent.doubleClick(screen.getByRole("button", { name: /Vocab · 일 · 더블클릭하여 수정/ }));
    const book = await screen.findByRole("textbox", { name: /일 15:00.*교재/ });
    fireEvent.change(book, { target: { value: "새 교재" } });
    fireEvent.keyDown(book, { key: "Enter" });
    await waitFor(() => expect(createLine).toHaveBeenCalledWith(
      { classId: "class-1", planDate: "2026-09-23", slotStart: "15:00" },
      { termMode: "regular", skillArea: "vocab" },
    ));
    await waitFor(() => expect(flushPatches).toHaveBeenCalledWith(expect.anything(), [expect.objectContaining({
      field: "textbook", expectedValue: null, newValue: "새 교재",
    })]));
  });
});
