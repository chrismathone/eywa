import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ pathname: "/students/abc" }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));

import { useWindowStore, windowId } from "./window-store";
import { useDeepLinkWindow } from "./deep-link-window";
import { DEFAULT_WINDOW } from "./window-geometry";

/** 이미 열려 있던 창들(복원된 레이아웃)을 흉내낸다. */
function seedWindows(ids: string[]) {
  const windows = Object.fromEntries(
    ids.map((raw) => {
      const id = windowId("route", raw);
      return [
        id,
        {
          id,
          kind: "route" as const,
          params: { id: raw, title: raw, href: `/${raw}` },
          rect: { x: 0, y: 0, w: DEFAULT_WINDOW.w, h: DEFAULT_WINDOW.h },
          minimized: false,
          maximized: false,
        },
      ];
    }),
  );
  const order = ids.map((raw) => windowId("route", raw));
  useWindowStore.setState({
    windows,
    order,
    focusedId: order[order.length - 1] ?? null,
    cached: [],
  });
}

describe("딥링크 창은 이미 열린 창들 **위**로 온다", () => {
  beforeEach(() => {
    navigation.pathname = "/students/abc";
    document.title = "학생 상세 — aywa";
    window.history.replaceState({}, "", "/students/abc");
  });

  it("🔴 창 3개가 이미 있어도 맨 위 + 포커스(원장 제보 2026-09-01 '다른 창들에 묻혀버린다')", () => {
    seedWindows(["timetable", "attendance", "classes"]);
    renderHook(() => useDeepLinkWindow(true));
    const id = windowId("route", "students/abc");
    const { order, focusedId } = useWindowStore.getState();
    expect(order[order.length - 1]).toBe(id); // z = order.indexOf + 1 이므로 맨 뒤 = 최상단
    expect(focusedId).toBe(id);
  });

  it("🔴 하이드레이션이 늦게 끝나도(리스너 경로) 복원 창 위로 온다", () => {
    // 하이드레이션 전: 스토어는 비어 있고, 훅은 onFinishHydration에 예약만 한다.
    useWindowStore.setState({ windows: {}, order: [], focusedId: null, cached: [] });
    type HydrationListener = Parameters<typeof useWindowStore.persist.onFinishHydration>[0];
    const pending: HydrationListener[] = [];
    const spyHas = vi.spyOn(useWindowStore.persist, "hasHydrated").mockReturnValue(false);
    const spyFin = vi
      .spyOn(useWindowStore.persist, "onFinishHydration")
      .mockImplementation((cb: HydrationListener) => {
        pending.push(cb);
        return () => {};
      });

    renderHook(() => useDeepLinkWindow(true));
    expect(useWindowStore.getState().order).toHaveLength(0); // 아직 안 열렸다

    // 하이드레이션 완료 = 영속 창 3개가 들어오고(리스너보다 먼저 state가 세팅된다) 리스너가 돈다.
    seedWindows(["timetable", "attendance", "classes"]);
    for (const cb of pending) cb(useWindowStore.getState());

    const id = windowId("route", "students/abc");
    const { order, focusedId } = useWindowStore.getState();
    expect(order).toHaveLength(4);
    expect(order[order.length - 1]).toBe(id);
    expect(focusedId).toBe(id);

    spyHas.mockRestore();
    spyFin.mockRestore();
  });

  it("🔴 최소화돼 있던 같은 창을 다시 열면 펼쳐지고 맨 위로", () => {
    seedWindows(["timetable", "students/abc", "classes"]);
    const id = windowId("route", "students/abc");
    useWindowStore.setState((s) => ({
      windows: { ...s.windows, [id]: { ...s.windows[id]!, minimized: true } },
    }));
    renderHook(() => useDeepLinkWindow(true));
    const { order, windows, focusedId } = useWindowStore.getState();
    expect(windows[id]?.minimized).toBe(false);
    expect(order[order.length - 1]).toBe(id);
    expect(focusedId).toBe(id);
  });
});
