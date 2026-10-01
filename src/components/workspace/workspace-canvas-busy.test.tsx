import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSelectedLayoutSegments: () => [], // 이전 화면 유지 방식의 바탕 판정용(창 모드에선 안 쓴다)
}));
// 녹음 방송(BroadcastChannel) — 구독 콜백을 붙잡아 다른 문서(다른 창·다른 탭)가 보낸 신호를 흉내 낸다.
type BusyMsg = { type: "busy"; winId: string; active: boolean };
const bus = vi.hoisted(() => ({ cb: null as null | ((m: BusyMsg) => void) }));
vi.mock("@/lib/realtime/window-busy", () => ({
  subscribeWindowBusy: (cb: (m: BusyMsg) => void) => {
    bus.cb = cb;
    return () => {
      bus.cb = null;
    };
  },
  publishWindowBusy: vi.fn(),
}));

import { WorkspaceCanvas } from "./workspace-canvas";
import { useWindowStore } from "./window-store";

/**
 * 녹음 방송(BroadcastChannel)은 **탭 새로고침 가드용 개수 세기**만 한다 — 창 잠금은 RouteWindow가 자기 iframe의
 * 신호로 정확한 창 id에 건다(전수검사 2026-09-11). 방송의 id는 경로로 추측한 것이라, 그걸로 잠금을 쓰면 드릴인
 * (상세 → 수정)에서 **없는 창**이 잠기고, 녹음 중에 그 id의 창을 새로 열면 영문 모르게 닫기가 막혔다(유령 잠금).
 */

const busy = (winId: string, active: boolean) => {
  act(() => bus.cb?.({ type: "busy", winId, active }));
};
/** 탭 새로고침·닫기를 시도한다 — 가드가 막았으면 true. */
function tryUnload() {
  const ev = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(ev);
  return ev.defaultPrevented;
}

beforeEach(() => {
  localStorage.clear();
  useWindowStore.setState({
    owner: null,
    windows: {},
    order: [],
    focusedId: null,
    live: {},
    nav: {},
    dirty: {},
    busy: {},
    cached: [],
    spotlight: false,
    spotlightRaised: [],
  });
  // 데스크톱(≥1024 + 마우스)으로 인식되게.
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
});

describe("WorkspaceCanvas — 녹음 방송은 탭 새로고침 가드만", () => {
  it("🔴 방송(경로로 추측한 id)으로는 창 잠금을 쓰지 않는다 — 유령 잠금이 안 남는다", () => {
    render(<WorkspaceCanvas owner="t1:u1" />);

    busy("route:enrollment/abc/edit", true);

    expect(useWindowStore.getState().busy["route:enrollment/abc/edit"]).toBeUndefined();
  });

  it("🔴 탭 새로고침 가드는 그대로 — 어느 문서(다른 탭 포함)든 녹음 중이면 막고, 전부 끝나야 푼다", () => {
    render(<WorkspaceCanvas owner="t1:u1" />);
    expect(tryUnload()).toBe(false);

    busy("route:meetings/new", true);
    expect(tryUnload()).toBe(true);

    busy("route:enrollment/abc/edit", true); // 다른 곳에서 또 녹음
    busy("route:meetings/new", false);
    expect(tryUnload()).toBe(true); // 하나가 아직 녹음 중

    busy("route:enrollment/abc/edit", false);
    expect(tryUnload()).toBe(false);
  });
});
