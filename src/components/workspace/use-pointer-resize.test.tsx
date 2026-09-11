import { act, renderHook } from "@testing-library/react";
import type { PointerEvent as RPointerEvent } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { usePointerResize } from "./use-pointer-resize";
import { useWindowStore, windowId } from "./window-store";
import { ROUTE_WINDOW_SIZE } from "./window-geometry";

/**
 * 포인터 리사이즈 바닥 — `store.resizeBy`와 같은 기준(창이 지금 보는 화면)이어야 한다.
 * 전수검사 2026-09-11: 출석부 창(1280) 안의 출결 모드(560)가 1280에서 멈췄다.
 */

const ATT = windowId("route", "attendance");
let bounds: { width: number; height: number };

beforeEach(() => {
  bounds = useWindowStore.getState().bounds;
  useWindowStore.setState({
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
    bounds: { width: 1600, height: 1000 },
  });
});
afterEach(() => {
  useWindowStore.setState({ bounds, draggingId: null });
});

/** 포인터 이벤트 흉내 — 훅이 읽는 필드만. */
function pe(x: number, y: number) {
  return {
    button: 0,
    clientX: x,
    clientY: y,
    pointerId: 1,
    currentTarget: { setPointerCapture() {}, releasePointerCapture() {} },
    stopPropagation() {},
    preventDefault() {},
  } as unknown as RPointerEvent<HTMLElement>;
}

/** 오른쪽 변을 한참 왼쪽으로 끌었다 놓는다. */
function dragRightEdgeFarLeft() {
  const ref = { current: document.createElement("div") };
  const { result } = renderHook(() => usePointerResize(ATT, ref));
  act(() => {
    result.current.start("e")(pe(1280, 300));
    result.current.onPointerMove(pe(-1000, 300));
    result.current.onPointerUp(pe(-1000, 300));
  });
}

describe("usePointerResize — 최소 크기는 창이 지금 보는 화면 기준", () => {
  it("🔴 출석부 창에서 출결 모드를 보고 있으면 출결 모드 폭까지 줄어든다", () => {
    useWindowStore.getState().open("route", { id: "attendance", title: "출결 모드", href: "/attendance/quick" });
    useWindowStore.getState().setRect(ATT, { x: 0, y: 0, w: 1280, h: 900 });

    dragRightEdgeFarLeft();

    expect(useWindowStore.getState().windows[ATT]?.rect.w).toBe(ROUTE_WINDOW_SIZE["attendance/quick"].w);
  });

  it("월별 출석부를 보고 있으면 종전대로 1280에서 멈춘다", () => {
    useWindowStore.getState().open("route", { id: "attendance", title: "출석부", href: "/attendance" });
    useWindowStore.getState().setRect(ATT, { x: 0, y: 0, w: 1400, h: 900 });

    dragRightEdgeFarLeft();

    expect(useWindowStore.getState().windows[ATT]?.rect.w).toBe(ROUTE_WINDOW_SIZE.attendance.w);
  });
});
