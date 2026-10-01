import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useDragPointer } from "./use-drag-pointer";

describe("드래그 화면 좌표", () => {
  it("센서가 document에서 처리하기 전에 좌표를 갱신하고 종료 뒤에는 추적하지 않는다", () => {
    const { result, unmount } = renderHook(() => useDragPointer());
    act(() => result.current.track(new MouseEvent("mousedown")));
    let duringSensor: unknown;
    document.addEventListener("mousemove", () => { duringSensor = result.current.pointer.current; }, { once: true });
    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 200, clientY: 450 }));
    expect(duringSensor).toEqual({ x: 200, y: 450 });
    const pointer = result.current.pointer;
    unmount();
    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 400 }));
    expect(pointer.current).toBeNull();
  });

  it("문서에서 빠진 카드도 첫 손가락만 추적하며 두 번째 손가락은 무시한다", () => {
    const { result } = renderHook(() => useDragPointer());
    const target = document.createElement("div");
    const start = new Event("touchstart");
    Object.defineProperties(start, { target: { value: target }, changedTouches: { value: [{ identifier: 7 }] } });
    act(() => result.current.track(start));
    const move = new Event("touchmove");
    Object.defineProperty(move, "touches", { value: [{ identifier: 8, clientX: 1, clientY: 2 }, { identifier: 7, clientX: 50, clientY: 80 }] });
    target.dispatchEvent(move);
    expect(result.current.pointer.current).toEqual({ x: 50, y: 80 });
    result.current.stop();
    target.dispatchEvent(move);
    expect(result.current.pointer.current).toBeNull();
  });
});
