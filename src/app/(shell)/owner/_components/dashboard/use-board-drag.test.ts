import { act, renderHook } from "@testing-library/react";
import type { DragStartEvent, DragMoveEvent, DragEndEvent } from "@dnd-kit/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { newItem } from "@/features/dashboard/layout/engine";
import type { BoardLayout } from "./geometry";
import { useBoardDrag } from "./use-board-drag";

afterEach(() => vi.useRealTimers());

describe("실제 카드 위에서 끌기", () => {
  it("실제 표시 좌표로 순서를 정하고, 그 사이 숨겨진 카드를 잃지 않는다", () => {
    vi.useFakeTimers();
    const items = [newItem("kpi:students"), newItem("panel:staff"), newItem("kpi:firstClass")];
    const rects = new Map([
      ["kpi:students", { left: 0, top: 0, width: 100, height: 150 }],
      ["kpi:firstClass", { left: 120, top: 0, width: 100, height: 150 }],
    ]);
    const layout: BoardLayout = {
      placed: [...rects].map(([id, r]) => ({ id, x: r.left, y: r.top, w: r.width, h: r.height })), rects,
      metrics: { colStep: 20, rowTops: [], rowHeights: [], height: 500 },
    };
    const canvas = document.createElement("div");
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 600, height: 500 } as DOMRect);
    const onCommit = vi.fn();
    const { result } = renderHook(() => useBoardDrag({ items, canvasRef: { current: canvas }, layoutRef: { current: layout }, onCommit, onRemoved: vi.fn() }));
    const active = { data: { current: { kind: "tile", id: "kpi:students" } }, rect: { current: { initial: { width: 100, height: 150 }, translated: null } } };
    act(() => result.current.handlers.onDragStart({ active, activatorEvent: new MouseEvent("mousedown", { clientX: 30, clientY: 40 }) } as unknown as DragStartEvent));
    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 210, clientY: 40 }));
      result.current.handlers.onDragMove({ over: { id: "canvas" }, delta: { x: 180, y: 0 } } as DragMoveEvent);
    });
    act(() => vi.advanceTimersByTime(80));
    act(() => result.current.handlers.onDragEnd({ active, over: { id: "canvas" } } as unknown as DragEndEvent));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0][0].map((i: { id: string }) => i.id)).toEqual(["panel:staff", "kpi:firstClass", "kpi:students"]);
  });
});
