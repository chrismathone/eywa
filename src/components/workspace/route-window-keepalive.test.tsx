import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

import { RouteWindow } from "./route-window";
import { ShellModeProvider } from "./shell-mode";
import { useWindowStore, windowId, type Win } from "./window-store";
import type { ShellMode } from "@/lib/license/shell-mode";

/**
 * 이전 화면 유지 방식에선 이미 연 화면을 다른 주소로 옮길 때 iframe `src` 속성을 바꾸지 않는다 — src 변경은 탭의 합동 세션 기록에 한 칸을
 * 쌓아 "뒤로 = 이전 화면"이 두 번 눌러야 되는 죽은 칸이 됐다(적대 리뷰 2026-10-01). 옮기기는 `location.replace`(RouteWindow 주소 변경 효과).
 * 창 모드는 종전대로 src가 따라간다(회귀 금지).
 */
const ID = windowId("route", "students");
const win = (href: string): Win => ({
  id: ID,
  kind: "route",
  params: { id: "students", title: "원생", href },
  rect: { x: 0, y: 0, w: 800, h: 600 },
  minimized: false,
  maximized: false,
});
const srcOf = (c: HTMLElement) => c.querySelector("iframe")?.getAttribute("src") ?? null;

function renderIn(mode: ShellMode, href: string) {
  const ui = (h: string) => (
    <ShellModeProvider mode={mode} epoch="t">
      <RouteWindow win={win(h)} />
    </ShellModeProvider>
  );
  const r = render(ui(href));
  act(() => {
    vi.advanceTimersByTime(0);
  });
  return { ...r, move: (h: string) => r.rerender(ui(h)) };
}

beforeEach(() => {
  vi.useFakeTimers();
  useWindowStore.setState({ windows: {}, order: [ID], focusedId: ID, cached: [], reloadNonce: {}, homeNonce: {}, dirty: {} });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("RouteWindow — 이전 화면 유지에선 src를 처음 주소로 고정한다", () => {
  it("🔴 이전 화면 유지: 다른 주소로 옮겨도 src 속성은 처음 실은 주소 그대로(이동은 location.replace)", () => {
    const { container, move } = renderIn("keepalive", "/students");
    expect(srcOf(container)).toBe("/students?embed=1");
    const frame = container.querySelector("iframe")!;
    const replace = vi.spyOn(frame.contentWindow!.location, "replace").mockImplementation(() => {});
    move("/students?tab=b");
    expect(srcOf(container)).toBe("/students?embed=1");
    expect(replace).toHaveBeenCalledWith("/students?tab=b&embed=1"); // 실제로 옮긴다(src만 고정하고 안 옮기면 화면이 그대로다)
  });

  it("창 모드는 종전대로 src가 새 주소를 따라간다", () => {
    const { container, move } = renderIn("windows", "/students");
    expect(srcOf(container)).toBe("/students?embed=1");
    move("/students?tab=b");
    expect(srcOf(container)).toBe("/students?tab=b&embed=1");
  });

  it("아직 안 연(최소화로 복원된) 화면은 처음 보일 때의 주소로 뜬다", () => {
    useWindowStore.setState({ focusedId: null });
    const ui = (h: string, minimized: boolean) => (
      <ShellModeProvider mode="keepalive" epoch="t">
        <RouteWindow win={{ ...win(h), minimized }} />
      </ShellModeProvider>
    );
    const { container, rerender } = render(ui("/students", true));
    rerender(ui("/students/abc", true));
    expect(srcOf(container)).toBeNull();
    useWindowStore.setState({ focusedId: ID });
    rerender(ui("/students/abc", false));
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(srcOf(container)).toBe("/students/abc?embed=1");
  });
});
