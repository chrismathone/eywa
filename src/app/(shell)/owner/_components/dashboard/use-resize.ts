"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { resizeItem } from "@/features/dashboard/layout/engine";
import { cardDef, nearestPreset, presetOf, type SizePreset } from "@/features/dashboard/layout/registry";
import type { Item, Placed } from "@/features/dashboard/layout/types";
import { GAP, ROW_H, gridSizeFromPixels, rectOf, type Metrics } from "./geometry";

/**
 * 모서리 손잡이로 크기 바꾸기 — 끄는 동안 **가장 가까운 허용 프리셋**으로 바로 스냅해서 보여 주고(다른 카드가 비켜 흐른다),
 * 손을 떼면 되돌리기 이력 한 칸. Esc = 취소. ½×1보다 작게 끌면 요약형이 된다(그 카드가 요약을 지원할 때).
 */
export function useResize(opts: {
  items: readonly Item[];
  layoutRef: RefObject<{ placed: Placed[]; metrics: Metrics } | null>;
  onCommit: (next: Item[]) => void;
}) {
  const { items, layoutRef, onCommit } = opts;
  const [resize, setResize] = useState<{ id: string; z: SizePreset } | null>(null);
  const live = useRef<{ id: string; pointerId: number; z: SizePreset; start: { x: number; y: number; w: number; h: number } } | null>(null);
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  });

  const end = useCallback(
    (commit: boolean) => {
      const cur = live.current;
      live.current = null;
      setResize(null);
      if (!commit || !cur) return;
      const item = itemsRef.current.find((i) => i.id === cur.id);
      const def = cardDef(cur.id);
      if (item && def && presetOf(def, item)?.key !== cur.z.key) onCommit(resizeItem(itemsRef.current, cur.id, cur.z));
    },
    [onCommit],
  );

  useEffect(() => {
    if (!resize) return;
    const move = (ev: PointerEvent) => {
      const cur = live.current;
      const layout = layoutRef.current;
      const def = cur && cardDef(cur.id);
      if (!cur || !layout || !def || ev.pointerId !== cur.pointerId) return;
      const want = gridSizeFromPixels(cur.start.w + ev.clientX - cur.start.x, cur.start.h + ev.clientY - cur.start.y, layout.metrics);
      const item = itemsRef.current.find((i) => i.id === cur.id);
      const z = nearestPreset(def, want.w, want.h, want.w < 4.5 ? "summary" : item?.mode);
      if (z.key !== cur.z.key) {
        cur.z = z;
        setResize({ id: cur.id, z });
      }
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId === live.current?.pointerId) end(true);
    };
    const cancel = (ev: PointerEvent) => {
      if (ev.pointerId === live.current?.pointerId) end(false);
    };
    const key = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") end(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key);
    };
  }, [resize, layoutRef, end]);

  const start = useCallback(
    (id: string, ev: ReactPointerEvent<HTMLElement>) => {
      if (ev.button !== 0 || !ev.isPrimary || live.current) return;
      const layout = layoutRef.current;
      const item = itemsRef.current.find((i) => i.id === id);
      const def = cardDef(id);
      const placed = layout?.placed.find((p) => p.id === id);
      if (!layout || !item || !def || !placed) return;
      ev.preventDefault();
      // 🔑 시작 크기 = **저장된 프리셋**의 크기 — 줄 채우기로 넓어진 화면 폭에서 재면 1px만 움직여도 한 단계 커진다(적대 리뷰 2026-10-01).
      const r = rectOf({ x: 0, y: 0, w: item.w, h: item.h }, { ...layout.metrics, rowHeights: [ROW_H, ROW_H], rowTops: [0, ROW_H + GAP] });
      const z = presetOf(def, item) ?? nearestPreset(def, item.w, item.h, item.mode);
      live.current = { id, pointerId: ev.pointerId, z, start: { x: ev.clientX, y: ev.clientY, w: r.width, h: r.height } };
      setResize({ id, z });
    },
    [layoutRef],
  );

  const preview = useMemo(() => (resize ? resizeItem(items, resize.id, resize.z) : null), [resize, items]);
  return { resize, preview, start };
}
