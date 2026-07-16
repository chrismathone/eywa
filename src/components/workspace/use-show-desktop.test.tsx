import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  pathname: "/dashboard",
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
    navigation.pathname = "/dashboard";
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

  it("이미 /dashboard면 라우트를 중복 push하지 않고 열린 창만 최소화한다", () => {
    useWindowStore
      .getState()
      .open("route", { id: "students", title: "학생목록", href: "/students" });
    const { result } = renderHook(() => useShowDesktop());

    act(() => result.current());

    expect(navigation.push).not.toHaveBeenCalled();
    expect(useWindowStore.getState().windows[windowId("route", "students")].minimized).toBe(true);
  });

  it("다른 main 라우트에서는 창을 정리한 뒤 /dashboard로 이동한다", () => {
    navigation.pathname = "/students";
    const { result } = renderHook(() => useShowDesktop());

    act(() => result.current());

    expect(navigation.push).toHaveBeenCalledOnce();
    expect(navigation.push).toHaveBeenCalledWith("/dashboard");
  });
});
