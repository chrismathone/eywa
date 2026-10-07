import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceEnabledProvider } from "@/components/workspace/workspace-enabled";
import { useWindowStore } from "@/components/workspace/window-store";
import { SheetLangProvider } from "@/features/teacher-view/lang-context";
import { EnglishNameProvider } from "./english-name-context";
import { RosterNameCell, type StudentMeta } from "./roster-slot-cells";
import type { RosterEntry } from "../lib/grid";

const m = vi.hoisted(() => ({ save: vi.fn(), refresh: vi.fn(), navigate: vi.fn() }));
vi.mock("@/features/students/server/english-name", () => ({ updateStudentEnglishName: m.save }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: m.refresh }) }));
vi.mock("@/components/workspace/use-is-desktop", () => ({ useIsDesktop: () => true }));
vi.mock("@/components/workspace/use-in-frame", () => ({ useInFrame: () => false }));
// WindowLink itself stays real. Only Next's router boundary becomes an anchor;
// the document listener below records navigation unless capture/bubble prevented it.
vi.mock("next/link", () => ({
  default: ({ prefetch, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) => {
    void prefetch;
    return <a {...props} />;
  },
}));

const entry = { studentId: "student-1", historical: false, endedOn: null } as RosterEntry;
const meta: StudentMeta = { name: "김하나", englishName: "Lucy", school: "칠성초", grade: "초5" };

function setup(enabled = true) {
  return render(<WorkspaceEnabledProvider enabled={false}>
    <SheetLangProvider lang="en"><EnglishNameProvider enabled={enabled}>
      <table><tbody><tr><RosterNameCell entry={entry} meta={meta} /></tr></tbody></table>
    </EnglishNameProvider></SheetLangProvider>
  </WorkspaceEnabledProvider>);
}

function recordUnpreventedNavigation(event: MouseEvent) {
  const link = event.target instanceof Element ? event.target.closest("a") : null;
  if (!link || event.defaultPrevented) return;
  m.navigate(link.getAttribute("href"));
  event.preventDefault();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  useWindowStore.setState({ windows: {}, order: [], focusedId: null });
  document.addEventListener("click", recordUnpreventedNavigation);
});
afterEach(() => {
  cleanup();
  document.removeEventListener("click", recordUnpreventedNavigation);
  vi.useRealTimers();
});

describe("English-name editing with the real WindowLink in the teacher shell", () => {
  it("keeps editing when the second press starts before the navigation delay but releases after it", async () => {
    setup();
    const name = screen.getByText("Lucy");
    fireEvent.mouseDown(name, { button: 0, detail: 1 });
    fireEvent.mouseUp(name, { button: 0, detail: 1 });
    fireEvent.click(name, { button: 0, detail: 1 });
    await act(() => vi.advanceTimersByTimeAsync(480));

    fireEvent.mouseDown(name, { button: 0, detail: 2 });
    await act(() => vi.advanceTimersByTimeAsync(70));
    expect(m.navigate).not.toHaveBeenCalled();
    fireEvent.mouseUp(name, { button: 0, detail: 2 });
    fireEvent.click(name, { button: 0, detail: 2 });
    fireEvent.doubleClick(name, { button: 0, detail: 2 });
    await act(() => vi.advanceTimersByTimeAsync(600));

    expect(screen.getByRole("textbox")).toHaveValue("Lucy");
    expect(m.navigate).not.toHaveBeenCalled();
    expect(useWindowStore.getState().order).toEqual([]);
  });

  it("opens student details once after a single click, without creating an invisible workspace window", async () => {
    setup();
    fireEvent.click(screen.getByText("Lucy"), { button: 0, detail: 1 });
    expect(m.navigate).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(499));
    expect(m.navigate).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));

    expect(m.navigate).toHaveBeenCalledExactlyOnceWith("/students/student-1");
    expect(useWindowStore.getState().order).toEqual([]);
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("navigates immediately without edit permission and never opens the editor", async () => {
    setup(false);
    const name = screen.getByText("Lucy");
    fireEvent.click(name, { button: 0, detail: 1 });
    expect(m.navigate).toHaveBeenCalledExactlyOnceWith("/students/student-1");
    fireEvent.doubleClick(name, { button: 0, detail: 2 });
    fireEvent.keyDown(screen.getByRole("link"), { key: "F2" });
    await act(() => vi.advanceTimersByTimeAsync(600));

    expect(m.navigate).toHaveBeenCalledOnce();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(useWindowStore.getState().order).toEqual([]);
    expect(m.save).not.toHaveBeenCalled();
  });

  it("keeps keyboard link activation immediate and F2 available for editing", async () => {
    setup();
    const link = screen.getByRole("link");
    fireEvent.click(link, { detail: 0 });
    expect(m.navigate).toHaveBeenCalledExactlyOnceWith("/students/student-1");
    fireEvent.keyDown(link, { key: "F2" });
    expect(screen.getByRole("textbox")).toHaveValue("Lucy");
    await act(() => vi.advanceTimersByTimeAsync(600));
    expect(m.navigate).toHaveBeenCalledOnce();
  });

  it.each(["ctrlKey", "metaKey", "shiftKey", "altKey"] as const)("leaves %s clicks to the existing link without scheduling a second navigation", async (modifier) => {
    setup();
    const name = screen.getByText("Lucy");
    fireEvent.mouseDown(name, { button: 0, detail: 1, [modifier]: true });
    fireEvent.mouseUp(name, { button: 0, detail: 1, [modifier]: true });
    fireEvent.click(name, { button: 0, detail: 1, [modifier]: true });
    expect(m.navigate).toHaveBeenCalledExactlyOnceWith("/students/student-1");
    await act(() => vi.advanceTimersByTimeAsync(600));

    expect(m.navigate).toHaveBeenCalledOnce();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(useWindowStore.getState().order).toEqual([]);
  });
});
