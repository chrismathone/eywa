import { act, renderHook } from "@testing-library/react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { newItem } from "@/features/dashboard/layout/engine";
import { layoutAt } from "@/features/dashboard/layout/flow";
import { metricsOf } from "./geometry";
import { useResize } from "./use-resize";

function setup() {
  const items = [newItem("panel:billingMonth")];
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
  it("취소된 터치 조작은 배치나 되돌리기 이력에 저장하지 않는다", () => {
    const { result, onCommit } = setup();
    move("pointermove", 1);
    move("pointercancel", 1);
    expect(result.current.resize).toBeNull();
    expect(onCommit).not.toHaveBeenCalled();
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
