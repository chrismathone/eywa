import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useWindowStore, windowId } from "./window-store";
import { WindowSwitcher } from "./window-switcher";

/**
 * 독(하단 오른쪽 창 전환기)은 **자동 숨김**이라 평소엔 작은 핸들만 보인다. 그런데 최소화한 창은
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
