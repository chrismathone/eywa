"use client";

import { useCallback, useMemo, useRef, useState, type RefObject } from "react";
import { MouseSensor, TouchSensor, pointerWithin, useSensor, useSensors, type CollisionDetection, type DragEndEvent, type DragMoveEvent, type DragStartEvent } from "@dnd-kit/core";
import { newItem, placedIds, removeItem } from "@/features/dashboard/layout/engine";
import { placeItem, positionItems } from "@/features/dashboard/layout/fixed-grid";
import { GRID_COLS, GRID_ROW_PX, MAX_ITEMS, isStructuralId, type Item } from "@/features/dashboard/layout/types";
import type { BoardLayout } from "./geometry";
import { startPoint, useDragPointer } from "./use-drag-pointer";
import { displayedItems } from "./displayed-items";

export type DropTarget = "canvas" | "drawer" | "trash";
export type DragState = {
  base: readonly Item[];
  kind: "tile" | "chip"; id: string; item: Item;
  start: { x: number; y: number }; offset: { x: number; y: number };
  x: number; y: number; target: DropTarget | null;
  size: { width: number; height: number };
};

export const boardCollision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  const pick = (id: DropTarget) => hits.find((h) => h.id === id);
  const hit = pick("trash") ?? pick("drawer") ?? pick("canvas");
  return hit ? [hit] : [];
};

/** 실제 격자 칸에 놓는다. 드래그 중에도 다른 카드의 빈칸을 다시 채우지 않는다. */
export function useBoardDrag({ items, canvasRef, layoutRef, onCommit, onRemoved }: {
  items: readonly Item[]; canvasRef: RefObject<HTMLElement | null>; layoutRef: RefObject<BoardLayout | null>;
  onCommit: (next: Item[]) => void; onRemoved: (id: string, before: Item[]) => void;
}) {
  const [drag, setDragState] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const { pointer, track, stop } = useDragPointer();
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 5 } }), useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }));
  const canRemove = placedIds(items).length > 1;
  const setDrag = useCallback((next: DragState | null) => { dragRef.current = next; setDragState(next); }, []);
  const onDragStart = useCallback((ev: DragStartEvent) => {
    const base = displayedItems(canvasRef.current, items);
    const data = ev.active.data.current as { kind: "tile" | "chip"; id: string } | undefined;
    const item = data ? (data.kind === "tile" ? positionItems(base).find((i) => i.id === data.id) : newItem(data.id)) : undefined;
    if (!data || !item) return;
    const r = ev.active.rect.current.initial;
    const start = startPoint(ev.activatorEvent);
    const box = canvasRef.current?.getBoundingClientRect();
    const rect = layoutRef.current?.rects?.get(item.id);
    const offset = data.kind === "tile" && box && rect ? { x: start.x - box.left - rect.left, y: start.y - box.top - rect.top } : { x: 0, y: 0 };
    track(ev.activatorEvent);
    setDrag({ base, kind: data.kind, id: item.id, item, start, offset, x: item.x ?? 0, y: item.y ?? 0, target: data.kind === "tile" ? "canvas" : "drawer", size: { width: rect?.width ?? r?.width ?? 160, height: rect?.height ?? r?.height ?? 40 } });
  }, [items, canvasRef, layoutRef, track, setDrag]);
  const onDragMove = useCallback((ev: DragMoveEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const target = (ev.over?.id as DropTarget | undefined) ?? null;
    if (target !== "canvas") { if (d.target !== target) setDrag({ ...d, target }); return; }
    const grid = canvasRef.current?.querySelector<HTMLElement>('[data-overview="free-grid"]');
    if (!grid) return;
    const box = grid.getBoundingClientRect();
    const style = getComputedStyle(grid);
    const gap = parseFloat(style.columnGap) || 16;
    const at = pointer.current ?? { x: d.start.x + ev.delta.x, y: d.start.y + ev.delta.y };
    const x = Math.max(0, Math.min(GRID_COLS - d.item.w, Math.round((at.x - box.left - d.offset.x) / ((box.width + gap) / GRID_COLS))));
    const y = Math.max(0, Math.round((at.y - box.top - d.offset.y) / (GRID_ROW_PX + (parseFloat(style.rowGap) || gap))));
    if (d.x !== x || d.y !== y || d.target !== target) setDrag({ ...d, target, x, y });
  }, [canvasRef, pointer, setDrag]);
  const finish = useCallback((ev: DragEndEvent | null) => {
    const d = dragRef.current;
    stop(); setDrag(null);
    if (!d || !ev) return;
    const target = (ev.over?.id as DropTarget | undefined) ?? null;
    if (target === "canvas" && d.target === "canvas") {
      if (d.kind === "chip" && items.length >= MAX_ITEMS) return;
      onCommit(placeItem(d.base, d.item, d.x, d.y));
    } else if (d.kind === "tile" && (target === "drawer" || target === "trash") && (canRemove || isStructuralId(d.id))) {
      onCommit(removeItem(items, d.id)); onRemoved(d.id, [...items]);
    }
  }, [items, canRemove, onCommit, onRemoved, setDrag, stop]);
  const preview = useMemo(() => {
    if (!drag) return null;
    if (drag.target === "canvas") return placeItem(drag.base, drag.item, drag.x, drag.y);
    if (drag.kind === "tile" && (drag.target === "drawer" || drag.target === "trash") && (canRemove || isStructuralId(drag.id))) return removeItem(items, drag.id);
    return null;
  }, [drag, items, canRemove]);
  return { drag, preview, sensors, canRemove, handlers: { onDragStart, onDragMove, onDragOver: onDragMove, onDragEnd: finish, onDragCancel: () => finish(null) } };
}
