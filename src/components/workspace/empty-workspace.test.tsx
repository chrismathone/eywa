import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ pathname: "/students", replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
// useSelectedLayoutSegments — 이전 화면 유지 방식의 바탕 판정용(창 모드에선 안 쓴다).
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname, useRouter: () => nav, useSelectedLayoutSegments: () => [] }));
import { WorkspaceCanvas } from "./workspace-canvas";
import { useWindowStore, windowId } from "./window-store";

describe("마지막 업무 창 뒤의 대시보드", () => {
  beforeEach(async () => {
    nav.pathname = "/students";
    nav.replace.mockReset();
    localStorage.clear();
    useWindowStore.setState({ owner: "tenant:user", windows: {}, order: [], cached: [], focusedId: null, dirty: {}, spotlight: false, spotlightRaised: [] });
    await useWindowStore.persist.rehydrate();
    window.history.replaceState({}, "", "/students?q=Kim");
    window.matchMedia = vi.fn().mockImplementation((media) => ({ media, matches: true, addEventListener() {}, removeEventListener() {} }));
  });
  afterEach(() => vi.restoreAllMocks());

  it("딥링크 창을 먼저 연 뒤 마지막 창이 닫힐 때만 대시보드로 돌아간다", async () => {
    render(<WorkspaceCanvas owner="tenant:user" />);
    const id = windowId("route", "students");
    await waitFor(() => expect(useWindowStore.getState().order).toContain(id));
    expect(useWindowStore.getState().windows[id].params.href).toBe("/students?q=Kim");
    expect(nav.replace).not.toHaveBeenCalled();
    act(() => useWindowStore.getState().close(id));
    expect(nav.replace).toHaveBeenCalledWith("/dashboard", { scroll: false });
    // 닫힌 창이 warm 캐시에 남아 있어도 열린 창으로 취급하지 않는다.
    expect(useWindowStore.getState().cached).toContain(id);
    act(() => useWindowStore.getState().setWindowDirty(id, false));
    expect(nav.replace).toHaveBeenCalledTimes(1);
  });

  it("다른 창이 열려 있으면 이동하지 않고 마지막 최소화 시 입력 상태를 보존한다", () => {
    render(<WorkspaceCanvas owner="tenant:user" />);
    const student = windowId("route", "students");
    act(() => useWindowStore.getState().open("route", { id: "billing", title: "수납", href: "/billing" }));
    const billing = windowId("route", "billing");
    act(() => useWindowStore.getState().close(student));
    expect(nav.replace).not.toHaveBeenCalled();
    act(() => useWindowStore.getState().setWindowDirty(billing, true));
    act(() => useWindowStore.getState().minimize(billing));
    expect(nav.replace).toHaveBeenCalledWith("/dashboard", { scroll: false });
    expect(useWindowStore.getState().dirty[billing]).toBe(true);
    expect(useWindowStore.getState().order).toContain(billing);
  });

  it("기본 대시보드에서는 창을 만들거나 대시보드로 재이동하지 않는다", () => {
    nav.pathname = "/dashboard";
    render(<WorkspaceCanvas owner="tenant:user" />);
    expect(useWindowStore.getState().order).toEqual([]);
    expect(nav.replace).not.toHaveBeenCalled();
    expect(document.documentElement.dataset.stage).toBeUndefined();
  });

  it("권한 제한 계정은 지정한 안내 화면으로 복귀한다", () => {
    render(<WorkspaceCanvas owner="tenant:user" homeHref="/menu" />);
    act(() => useWindowStore.getState().close(windowId("route", "students")));
    expect(nav.replace).toHaveBeenCalledWith("/menu", { scroll: false });
  });

  it("복원이 늦게 끝나도 계정 채택 중의 빈 상태에서 잘못 이동하지 않는다", () => {
    type Listener = Parameters<typeof useWindowStore.persist.onFinishHydration>[0];
    const listeners = new Set<Listener>();
    const hydrated = vi.spyOn(useWindowStore.persist, "hasHydrated").mockReturnValue(false);
    vi.spyOn(useWindowStore.persist, "onFinishHydration").mockImplementation((listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    });
    render(<WorkspaceCanvas owner="tenant:user" />);
    expect(nav.replace).not.toHaveBeenCalled();
    hydrated.mockReturnValue(true);
    act(() => { for (const listener of listeners) listener(useWindowStore.getState()); });
    expect(useWindowStore.getState().order).toContain(windowId("route", "students"));
    expect(nav.replace).not.toHaveBeenCalled();
    act(() => useWindowStore.getState().close(windowId("route", "students")));
    expect(nav.replace).toHaveBeenCalledWith("/dashboard", { scroll: false });
  });
});
