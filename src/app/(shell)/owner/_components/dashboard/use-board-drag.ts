"use client";

import { useCallback, useMemo, useRef, useState, type RefObject } from "react";
import {
  MouseSensor,
  TouchSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { insertAt, newItem, placedIds, removeItem } from "@/features/dashboard/layout/engine";
import { MAX_ITEMS, type Item, type Placed } from "@/features/dashboard/layout/types";
import { insertionIndex, rectOf, type Metrics, type Rect } from "./geometry";

export type DropTarget = "canvas" | "drawer" | "trash";
export type DragState = {
  kind: "tile" | "chip";
  id: string;
  item: Item;
  start: { x: number; y: number };
  /** 끼울 자리(끄는 카드를 뺀 목록의 순서). */
  index: number | null;
  target: DropTarget | null;
  size: { width: number; height: number };
};

/** 머무름 — 다른 자리 후보가 이만큼 유지돼야 비켜 흐른다(빠르게 지나가며 줄이 떨지 않게, '잠깐 대면 비킨다'). */
const DWELL_MS = 70;

/** 겹친 곳에선 휴지통 → 서랍 → 캔버스 순으로 고른다(휴지통은 캔버스 위에 떠 있다). */
export const boardCollision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  const pick = (id: DropTarget) => hits.find((h) => h.id === id);
  const hit = pick("trash") ?? pick("drawer") ?? pick("canvas");
  return hit ? [hit] : [];
};

function startPoint(ev: Event | null): { x: number; y: number } {
  if (ev && "touches" in ev && (ev as TouchEvent).touches.length) {
    const t = (ev as TouchEvent).touches[0]!;
    return { x: t.clientX, y: t.clientY };
  }
  const m = ev as MouseEvent | null;
  return { x: m?.clientX ?? 0, y: m?.clientY ?? 0 };
}

/**
 * 캔버스·서랍 끌기 — 카드를 들면 다른 카드가 **실시간으로 비켜 흐르고**(미리보기 순서), 놓으면 되돌리기 이력 한 칸이 된다.
 * 서랍·휴지통 위에서 놓으면 빠진다(마지막 카드 한 장은 못 뺀다). 캔버스·서랍 밖에서 놓으면 제자리(아무 일도 없음).
 */
export function useBoardDrag(opts: {
  items: readonly Item[];
  canvasRef: RefObject<HTMLElement | null>;
  layoutRef: RefObject<{ placed: Placed[]; metrics: Metrics } | null>;
  onCommit: (next: Item[]) => void;
  onRemoved: (id: string, before: Item[]) => void;
  onDropped: (id: string, from: Rect) => void;
}) {
  const { items, canvasRef, layoutRef, onCommit, onRemoved, onDropped } = opts;
  const [drag, setDragState] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const pending = useRef<{ index: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  /**
   * 포인터의 **지금 화면 좌표** — 이벤트에서 직접 읽는다. 🔴 dnd-kit의 `delta`는 끄는 동안 생긴 스크롤 변화까지 이미 품고 있어,
   * 시작 좌표 + delta에서 지금 캔버스 위치(스크롤 뒤)를 또 빼면 스크롤한 만큼이 두 번 들어가 끼울 자리가 밀린다(적대 리뷰 2026-10-01).
   */
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const stopTracking = useRef<(() => void) | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
  );
  const canRemove = placedIds(items).length > 1;

  const setDrag = useCallback((next: DragState | null) => {
    dragRef.current = next;
    setDragState(next);
  }, []);
  const track = useCallback((activator: Event | null) => {
    // 주 포인터만(두 번째 손가락이 좌표를 덮어쓰지 않게) · 터치는 시작한 손가락만.
    const onPointer = (ev: PointerEvent | MouseEvent) => {
      if ("isPrimary" in ev && !ev.isPrimary) return;
      pointer.current = { x: ev.clientX, y: ev.clientY };
    };
    const touchId = activator && "changedTouches" in activator ? (activator as TouchEvent).changedTouches[0]?.identifier : undefined;
    const onTouch = (ev: TouchEvent) => {
      const t = [...ev.touches].find((x) => touchId === undefined || x.identifier === touchId);
      if (t) pointer.current = { x: t.clientX, y: t.clientY };
    };
    // 🔑 터치는 시작한 요소에도 건다 — 끄는 카드가 미리보기에서 빠져 문서에서 떨어지면 그 요소의 touchmove는 window까지 안 올라온다.
    const target = activator?.target instanceof EventTarget ? activator.target : null;
    window.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener("mousemove", onPointer, { passive: true });
    window.addEventListener("touchmove", onTouch, { passive: true });
    target?.addEventListener("touchmove", onTouch as EventListener, { passive: true });
    stopTracking.current = () => {
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("mousemove", onPointer);
      window.removeEventListener("touchmove", onTouch);
      target?.removeEventListener("touchmove", onTouch as EventListener);
      pointer.current = null;
    };
  }, []);
  const clearPending = useCallback(() => {
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = null;
  }, []);

  const onDragStart = useCallback(
    (ev: DragStartEvent) => {
      const data = ev.active.data.current as { kind: "tile" | "chip"; id: string } | undefined;
      const item = data ? (data.kind === "tile" ? items.find((i) => i.id === data.id) : newItem(data.id)) : undefined;
      if (!data || !item) return;
      const r = ev.active.rect.current.initial;
      track(ev.activatorEvent);
      setDrag({
        kind: data.kind,
        id: data.id,
        item,
        start: startPoint(ev.activatorEvent),
        index: data.kind === "tile" ? items.findIndex((i) => i.id === data.id) : null,
        target: data.kind === "tile" ? "canvas" : "drawer",
        size: { width: r?.width ?? 160, height: r?.height ?? 40 },
      });
    },
    [items, setDrag, track],
  );

  const onDragMove = useCallback(
    (ev: DragMoveEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const target = (ev.over?.id as DropTarget | undefined) ?? null;
      if (target !== "canvas") {
        clearPending();
        if (d.target !== target) setDrag({ ...d, target });
        return;
      }
      const layout = layoutRef.current;
      const box = canvasRef.current?.getBoundingClientRect();
      if (!layout || !box) return;
      const at = pointer.current ?? { x: d.start.x + ev.delta.x, y: d.start.y + ev.delta.y };
      const p = { x: at.x - box.left, y: at.y - box.top };
      const others = layout.placed.filter((pl) => pl.id !== d.id).map((pl) => ({ id: pl.id, rect: rectOf(pl, layout.metrics), full: pl.w >= 24 }));
      const me = d.target === "canvas" ? layout.placed.find((pl) => pl.id === d.id) : undefined;
      const want = insertionIndex(others, p, me ? rectOf(me, layout.metrics) : null, d.target === "canvas" ? d.index : null);
      // 캔버스에 처음 들어올 때는 바로, 그다음부터는 잠깐 머물러야 자리가 바뀐다.
      if (d.target !== "canvas" || d.index === null) {
        clearPending();
        setDrag({ ...d, target, index: want });
        return;
      }
      if (want === d.index) return clearPending();
      if (pending.current?.index === want) return;
      clearPending();
      pending.current = {
        index: want,
        timer: setTimeout(() => {
          pending.current = null;
          const cur = dragRef.current;
          if (cur && cur.target === "canvas") setDrag({ ...cur, index: want });
        }, DWELL_MS),
      };
    },
    [canvasRef, layoutRef, clearPending, setDrag],
  );

  const finish = useCallback(
    (ev: DragEndEvent | null) => {
      const d = dragRef.current;
      const settled = pending.current?.index;
      clearPending();
      stopTracking.current?.();
      stopTracking.current = null;
      setDrag(null);
      if (!d || !ev) return;
      const target = (ev.over?.id as DropTarget | undefined) ?? null;
      if (target === "canvas") {
        if (d.kind === "chip" && items.length >= MAX_ITEMS) return;
        const base = d.kind === "tile" ? items.filter((i) => i.id !== d.id) : [...items];
        onCommit(insertAt(base, d.item, settled ?? d.index ?? base.length));
        const from = ev.active.rect.current.translated;
        if (from) onDropped(d.id, { left: from.left, top: from.top, width: from.width, height: from.height });
        return;
      }
      if (d.kind === "tile" && (target === "drawer" || target === "trash") && canRemove) {
        const before = [...items];
        onCommit(removeItem(items, d.id));
        onRemoved(d.id, before);
      }
    },
    [items, canRemove, onCommit, onDropped, onRemoved, clearPending, setDrag],
  );

  /** 끄는 동안 보여 줄 순서 — 캔버스 위면 끼운 자리, 서랍·휴지통 위면 빠진 모습, 그 밖이면 원래대로. */
  const preview = useMemo(() => {
    if (!drag) return null;
    if (drag.target === "canvas" && drag.index !== null) {
      if (drag.kind === "chip" && items.length >= MAX_ITEMS) return null;
      const base = drag.kind === "tile" ? items.filter((i) => i.id !== drag.id) : [...items];
      return insertAt(base, drag.item, drag.index);
    }
    if (drag.kind === "tile" && (drag.target === "drawer" || drag.target === "trash") && canRemove) return removeItem(items, drag.id);
    return null;
  }, [drag, items, canRemove]);

  return {
    drag,
    preview,
    sensors,
    canRemove,
    handlers: { onDragStart, onDragMove, onDragEnd: finish, onDragCancel: () => finish(null) },
  };
}
