import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  pathname: "/menu",
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: navigation.push }),
}));

import { useWindowStore, windowId } from "./window-store";
import { useShowDesktop } from "./use-show-desktop";

describe("useShowDesktop", () => {
  beforeEach(() => {
    navigation.pathname = "/menu";
    navigation.push.mockReset();
    useWindowStore.setState({
      windows: {},
      order: [],
      focusedId: null,
      cached: [],
      live: {},
      nav: {},
      reloadNonce: {},
      dirty: {},
      spotlight: false,
      spotlightRaised: [],
    });
  });

  it("이미 배경(/menu)이면 라우트를 중복 push하지 않고 열린 창만 최소화한다", () => {
    useWindowStore
      .getState()
      .open("route", { id: "students", title: "학생목록", href: "/students" });
    const { result } = renderHook(() => useShowDesktop());

    act(() => result.current());

    expect(navigation.push).not.toHaveBeenCalled();
    expect(useWindowStore.getState().windows[windowId("route", "students")].minimized).toBe(true);
  });

  // 🔴 배경은 이제 **메뉴 화면**이다(2026-09-07) — 운영실이 아니다.
  it("다른 main 라우트에서는 창을 내린 뒤 /menu로 이동한다", () => {
    navigation.pathname = "/students";
    const { result } = renderHook(() => useShowDesktop());

    act(() => result.current());

    expect(navigation.push).toHaveBeenCalledOnce();
    expect(navigation.push).toHaveBeenCalledWith("/menu");
  });

  it("🔴 열린 창을 지우지 않는다 — 최소화만(옛 'dashboard 창 제거' 정리를 걷어냈다)", () => {
    const store = useWindowStore.getState();
    store.open("route", { id: "dashboard", title: "운영실", href: "/dashboard" });
    const { result } = renderHook(() => useShowDesktop());

    act(() => result.current());

    const win = useWindowStore.getState().windows[windowId("route", "dashboard")];
    expect(win).toBeDefined();
    expect(win!.minimized).toBe(true);
  });
});
