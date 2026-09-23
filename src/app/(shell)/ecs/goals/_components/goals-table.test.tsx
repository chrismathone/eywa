import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GoalsTable } from "./goals-table";

vi.mock("@/components/workspace/use-in-frame", () => ({ useInFrame: () => true }));
vi.mock("@/components/workspace/use-is-desktop", () => ({ useIsDesktop: () => true }));
vi.mock("@/components/ui/drag-scroll-area", () => ({
  DragScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("반 계획 보기의 반 링크", () => {
  it("창 안에서 Shift+클릭하면 브라우저 기본 새 창 대신 앱 작업면에 새 창을 요청한다", () => {
    const postMessage = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
    render(
      <GoalsTable
        rows={[{ classId: "class-1", className: "중등E_중1 MED", teacherName: null, hasLessonOnDate: true, cells: [] }]}
        areas={[]}
        weekMonday="2026-09-21"
        lang="ko"
        role="all"
        showDay
        classLabel={(name) => name}
        teacherLabel={() => null}
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
});
