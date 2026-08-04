import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { usePrefs } from "./use-prefs";
import { useWindowStore, windowId } from "./window-store";
import { WindowSwitcher } from "./window-switcher";

/**
 * 독(하단 왼쪽 창 전환기)은 **자동 숨김**이라 평소엔 작은 핸들만 보인다. 그런데 최소화한 창은
 * 화면에서 통째로 사라지고(사이드바 점도 비최소화 창만 표시) 독이 되살릴 유일한 경로다 —
 * 그 상태에서까지 독이 숨으면 창이 갇힌다(원장 제보 2026-07-31 "아무것도 안 보이네").
 * 여기서 잠그는 계약: **최소화한 창이 있으면 호버 없이도 칩이 보인다.**
 */
describe("WindowSwitcher — 최소화한 창이 있으면 독을 고정 노출", () => {
  beforeEach(() => {
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
    usePrefs.setState({ dockCollapsed: false });
  });

  it("창 하나를 최소화하면 호버 전에도 그 창 칩이 보인다", () => {
    const st = useWindowStore.getState();
    st.open("route", { id: "students", title: "학생목록", href: "/students" });
    st.minimize(windowId("route", "students"));

    render(<WindowSwitcher />);

    expect(screen.getByText("학생목록")).toBeTruthy();
  });

  it("전부 열려 있으면 평소대로 숨는다(핸들만) — 본문을 가리지 않는다", () => {
    const st = useWindowStore.getState();
    st.open("route", { id: "students", title: "학생목록", href: "/students" });
    st.open("route", { id: "classes", title: "수업목록", href: "/classes" });

    render(<WindowSwitcher />);

    expect(screen.queryByText("학생목록")).toBeNull();
    expect(screen.queryByText("수업목록")).toBeNull();
  });

  it("창이 1개뿐이고 그게 열려 있으면 독 자체를 렌더하지 않는다", () => {
    useWindowStore
      .getState()
      .open("route", { id: "students", title: "학생목록", href: "/students" });

    const { container } = render(<WindowSwitcher />);

    expect(container.firstChild).toBeNull();
  });
});

/**
 * 자리·접기 계약(원장 제보 2026-08-04 "저장버튼하고 겹쳐서 누르는데 애로사항이 있다").
 * 폼 저장 바(FormActionBar)는 규약상 창 하단 **우측 정렬**이라 하단 오른쪽은 저장/취소 버튼의 자리다.
 * 하단 중앙은 목록 페이지네이션(07-30에 그래서 오른쪽으로 옮겼다) → 남는 자리는 하단 **왼쪽**뿐.
 * 그래도 겹치는 화면이 나오면 사용자가 접을 수 있어야 하고, **접어도 최소화 창은 되살릴 수 있어야 한다.**
 */
describe("WindowSwitcher — 하단 왼쪽 + 접기/펼치기", () => {
  beforeEach(() => {
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
    usePrefs.setState({ dockCollapsed: false });
  });

  it("독은 하단 **왼쪽**에 붙는다 — 우측 정렬 저장 버튼과 겹치지 않게", () => {
    const st = useWindowStore.getState();
    st.open("route", { id: "students", title: "학생목록", href: "/students" });
    st.minimize(windowId("route", "students"));

    const { container } = render(<WindowSwitcher />);
    const root = container.firstChild as HTMLElement;

    expect(root.className).toContain("left-2");
    expect(root.className).not.toContain("right-2");
  });

  it("접으면 최소화 창이 있어도 칩이 숨고, 최소화 개수를 띄운 펼치기 버튼만 남는다", () => {
    const st = useWindowStore.getState();
    st.open("route", { id: "students", title: "학생목록", href: "/students" });
    st.open("route", { id: "classes", title: "수업목록", href: "/classes" });
    st.minimize(windowId("route", "students"));
    usePrefs.setState({ dockCollapsed: true });

    render(<WindowSwitcher />);

    // 칩은 없다(접었으니) — 그런데 최소화 창이 갇히면 안 되므로 그 개수는 반드시 보인다.
    expect(screen.queryByText("학생목록")).toBeNull();
    expect(screen.getByText("최소화 1")).toBeTruthy();
  });

  it("펼치기 버튼을 누르면 다시 칩이 보인다(접힘 해제가 영속 설정에 저장)", () => {
    const st = useWindowStore.getState();
    st.open("route", { id: "students", title: "학생목록", href: "/students" });
    st.minimize(windowId("route", "students"));
    usePrefs.setState({ dockCollapsed: true });

    const { rerender } = render(<WindowSwitcher />);
    fireEvent.click(screen.getByText("최소화 1"));
    rerender(<WindowSwitcher />);

    expect(usePrefs.getState().dockCollapsed).toBe(false);
    expect(screen.getByText("학생목록")).toBeTruthy();
  });
});
