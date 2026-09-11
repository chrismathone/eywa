import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

import { WorkspaceCanvas } from "./workspace-canvas";
import { useWindowStore, windowId } from "./window-store";
import { iframeRegistry } from "./route-window";

/**
 * 창(iframe) 안의 링크가 부모 작업면에 창을 열어 달라는 신호(`eywa-open-window`)의 **Shift+클릭** 뜻.
 * 최상위에서 Shift+클릭은 "같은 화면을 새 창으로 한 벌 더"인데, 창 안에서 누르면 `open()`이라 이미 떠 있는
 * 그 창이 그 주소로 옮겨졌다(2026-09-11 리뷰) — 보던 창의 자리를 잃는다.
 */

const OWNER = "t1:u1";
const TT = windowId("route", "timetable");
const SOURCE_ID = "route:help"; // 신호를 보낸 창(도움말) — 레지스트리에만 심는다
const source = { name: "help-frame" };

function send(data: Record<string, unknown>) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", { data, origin: window.location.origin, source: source as unknown as Window }),
    );
  });
}

describe("창 안 신호 eywa-open-window — Shift+클릭은 새 인스턴스", () => {
  beforeEach(() => {
    localStorage.clear();
    window.matchMedia = ((q: string) => ({
      matches: true,
      media: q,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    useWindowStore.setState({
      owner: OWNER,
      windows: {
        [TT]: {
          id: TT,
          kind: "route",
          params: { id: "timetable", title: "시간표", href: "/timetable" },
          rect: { x: 20, y: 20, w: 1040, h: 680 },
          minimized: false,
          maximized: false,
        },
      },
      order: [TT],
      focusedId: TT,
      cached: [],
      live: {},
      nav: {},
      spotlight: false,
      spotlightRaised: [],
    });
    iframeRegistry.set(SOURCE_ID, { contentWindow: source } as unknown as HTMLIFrameElement);
  });
  afterEach(() => {
    iframeRegistry.delete(SOURCE_ID);
    cleanup();
  });

  it("🔴 newInstance면 같은 화면을 새 창으로 한 벌 더 — 이미 떠 있는 창은 제자리", () => {
    render(<WorkspaceCanvas owner={OWNER} />);
    send({ type: "eywa-open-window", id: "timetable", title: "시간표", href: "/timetable?week=2026-09-14", newInstance: true });
    const s = useWindowStore.getState();
    expect(s.windows[TT]?.params.href).toBe("/timetable");
    expect(s.windows[`${TT}#1`]?.params.href).toBe("/timetable?week=2026-09-14");
  });

  it("맨 신호(Shift 없음)는 종전대로 떠 있는 그 창을 그 주소로 보낸다", () => {
    render(<WorkspaceCanvas owner={OWNER} />);
    send({ type: "eywa-open-window", id: "timetable", title: "시간표", href: "/timetable?week=2026-09-14" });
    const s = useWindowStore.getState();
    expect(s.order.filter((id) => id.startsWith(TT))).toEqual([TT]);
    expect(s.windows[TT]?.params.href).toBe("/timetable?week=2026-09-14");
  });
});
