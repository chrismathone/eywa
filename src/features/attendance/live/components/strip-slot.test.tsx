import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SheetLangProvider } from "@/features/teacher-view/lang-context";
import { StripSlot } from "./strip-slot";

const actions = vi.hoisted(() => ({ bulk: vi.fn(), request: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: actions.refresh }) }));
vi.mock("@/features/attendance/server/actions", () => ({ setAttendanceBulk: actions.bulk }));
vi.mock("@/features/attendance/live/server/actions", () => ({ requestDeskConfirm: actions.request }));
// eslint-disable-next-line shadcn/no-unknown-classes -- className is a saved course title here, not a CSS class list.
const courseTitle = "중등E_초등 브릿지 A";
const props = { date: "2026-10-07", classId: "class-1", className: courseTitle, slotStart: "14:20", saveSlot: "14:20", periodLabel: "1교시", pendingIds: ["student-1", "student-2"], pendingStudents: [{ name: "김하나", englishName: "Lucy" }, { name: "김둘", englishName: null }], deskRequested: false };
beforeEach(() => { vi.clearAllMocks(); actions.bulk.mockResolvedValue({ applied: [] }); });
afterEach(cleanup);
it("matches class names, student names and hover text to the live display language", () => {
  const view = render(<SheetLangProvider lang="en"><StripSlot {...props} /></SheetLangProvider>);
  expect(screen.getByText("MidE_Elem Bridge A")).toHaveAttribute("title", "MidE_Elem Bridge A");
  expect(screen.getByText("Lucy, 김둘")).toHaveAttribute("title", "Lucy, 김둘");
  expect(screen.getByText(/Period 1/)).toBeInTheDocument();
  view.rerender(<SheetLangProvider lang="ko"><StripSlot {...props} /></SheetLangProvider>);
  expect(screen.getByText(props.className)).toBeInTheDocument();
  expect(screen.getByText("김하나, 김둘")).toBeInTheDocument();
});
it("sends the original IDs and period when marking everyone present", async () => {
  render(<SheetLangProvider lang="en"><StripSlot {...props} /></SheetLangProvider>);
  fireEvent.click(screen.getByRole("button", { name: "All present" }));
  await waitFor(() => expect(actions.refresh).toHaveBeenCalledOnce());
  expect(actions.bulk).toHaveBeenCalledWith({ sessionDate: props.date, status: "present", cells: props.pendingIds.map((studentId) => ({ studentId, classId: props.classId })), fillEmptyOnly: true, slotStart: props.saveSlot, periodStart: props.slotStart });
});
it("localizes a rejected attendance change", async () => {
  actions.bulk.mockResolvedValue({ error: "수정 권한이 없습니다" });
  render(<SheetLangProvider lang="en"><StripSlot {...props} /></SheetLangProvider>);
  fireEvent.click(screen.getByRole("button", { name: "All present" }));
  expect(await screen.findByText("You do not have permission to make this change.")).toBeInTheDocument();
  expect(actions.refresh).not.toHaveBeenCalled();
});
