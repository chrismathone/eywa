import { act, renderHook } from "@testing-library/react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { newItem } from "@/features/dashboard/layout/engine";
import { layoutAt } from "@/features/dashboard/layout/flow";
import { positionItems } from "@/features/dashboard/layout/fixed-grid";
import { metricsOf, type BoardLayout } from "./geometry";
import { useResize } from "./use-resize";

function setup() {
  const items = positionItems([newItem("panel:billingMonth")]);
  const placed = layoutAt(items, "desktop");
  const onCommit = vi.fn();
  const layoutRef = { current: { placed, metrics: metricsOf(placed, 1200) } };
  const hook = renderHook(() => useResize({ items, layoutRef, onCommit }));
  act(() => hook.result.current.start(items[0].id, {
    clientX: 0, clientY: 0, pointerId: 1, button: 0, isPrimary: true, preventDefault() {},
  } as ReactPointerEvent<HTMLElement>));
  return { ...hook, onCommit };
}
const move = (type: string, pointerId: number) => act(() => {
  window.dispatchEvent(new PointerEvent(type, { pointerId, clientX: 600, clientY: 120 }));
});

describe("카드 크기 손잡이", () => {
  it("고정 격자에서 작은 손 떨림은 크기를 바꾸지 않는다", () => {
    const items = positionItems([newItem("panel:billingMonth")]);
    const placed = items;
    const layout: BoardLayout = { placed, metrics: { colStep: 50, rowTops: [], rowHeights: [], height: 304 }, columnScale: 1,
      rects: new Map([[items[0].id, { left: 0, top: 0, width: 284, height: 304 }]]) };
    const onCommit = vi.fn();
    const { result } = renderHook(() => useResize({ items, layoutRef: { current: layout }, onCommit }));
    act(() => result.current.start(items[0].id, {
      clientX: 0, clientY: 0, pointerId: 1, button: 0, isPrimary: true, preventDefault() {},
    } as ReactPointerEvent<HTMLElement>));
    const original = result.current.resize!.z;
    act(() => window.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 12, clientY: 12 })));
    expect(result.current.resize!.z).toEqual(original);
    act(() => window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 })));
    expect(onCommit).not.toHaveBeenCalled();
  });
  it("취소된 터치 조작은 배치나 되돌리기 이력에 저장하지 않는다", () => {
    const { result, onCommit } = setup();
    move("pointermove", 1);
    move("pointercancel", 1);
    expect(result.current.resize).toBeNull();
    expect(onCommit).not.toHaveBeenCalled();
  });
  it("프리셋 사이 너비·높이도 행과 열 단위로 저장한다", () => {
    const { result, onCommit } = setup();
    act(() => window.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 150, clientY: 160 })));
    expect(result.current.resize?.z).toMatchObject({ w: 9, h: 6 });
    act(() => window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 })));
    expect(onCommit.mock.calls[0][0][0]).toMatchObject({ w: 9, h: 6, x: 0, y: 0 });
  });
  it("두 번째 손가락을 떼어도 끝내지 않고 첫 손가락을 뗄 때 한 번 저장한다", () => {
    const { result, onCommit } = setup();
    move("pointermove", 1);
    move("pointerup", 2);
    expect(result.current.resize).not.toBeNull();
    expect(onCommit).not.toHaveBeenCalled();
    move("pointerup", 1);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});
