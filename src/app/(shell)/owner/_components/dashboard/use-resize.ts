"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { resizeItem } from "@/features/dashboard/layout/engine";
import type { SizePreset } from "@/features/dashboard/layout/registry";
import { GRID_COLS, GRID_ROW_PX, MAX_ROW_SPAN, type Item } from "@/features/dashboard/layout/types";
import type { BoardLayout } from "./geometry";

const custom = (w: number, h: number, mode?: "summary"): SizePreset => ({ key: `${w}:${h}`, label: `${w}열 × ${h}행`, hint: "직접 설정", w, h, mode });

/**
 * 모서리를 끌어 행·열 단위로 자유롭게 확장한다. 겹치는 카드만 아래로 이동한다.
 * 손을 떼면 되돌리기 이력 한 칸. Esc = 취소. 요약형 전환은 설정의 프리셋에서만 한다.
 */
export function useResize(opts: {
  items: readonly Item[];
  layoutRef: RefObject<BoardLayout | null>;
  onCommit: (next: Item[]) => void;
}) {
  const { items, layoutRef, onCommit } = opts;
  const [resize, setResize] = useState<{ id: string; z: SizePreset } | null>(null);
  const live = useRef<{ id: string; pointerId: number; z: SizePreset; start: { x: number; y: number; w: number; h: number; col: number; row: number } } | null>(null);
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
      if (item && (item.w !== cur.z.w || item.h !== cur.z.h)) onCommit(resizeItem(itemsRef.current, cur.id, cur.z));
    },
    [onCommit],
  );

  useEffect(() => {
    if (!resize) return;
    const move = (ev: PointerEvent) => {
      const cur = live.current;
      const layout = layoutRef.current;
      if (!cur || !layout || ev.pointerId !== cur.pointerId) return;
      const want = { w: Math.max(1, cur.start.w + (ev.clientX - cur.start.x) / cur.start.col), h: Math.max(1, cur.start.h + (ev.clientY - cur.start.y) / cur.start.row) };
      const item = itemsRef.current.find((i) => i.id === cur.id);
      const z = custom(Math.max(1, Math.min(GRID_COLS - (item?.x ?? 0), Math.round(want.w))), Math.min(MAX_ROW_SPAN, Math.round(want.h)), item?.mode);
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
      const placed = layout?.placed.find((p) => p.id === id);
      if (!layout || !item || !placed) return;
      ev.preventDefault();
      // 🔑 시작 크기 = **저장된 프리셋**의 크기 — 줄 채우기로 넓어진 화면 폭에서 재면 1px만 움직여도 한 단계 커진다(적대 리뷰 2026-10-01).
      const actual = layout.rects?.get(id);
      const col = layout.metrics.colStep * (layout.columnScale ?? 1);
      const row = GRID_ROW_PX + (actual ? Math.max(0, col * item.w - actual.width) : 16);
      const z = custom(item.w, item.h, item.mode);
      live.current = { id, pointerId: ev.pointerId, z, start: { x: ev.clientX, y: ev.clientY, w: item.w, h: item.h, col, row } };
      setResize({ id, z });
    },
    [layoutRef],
  );

  const preview = useMemo(() => (resize ? resizeItem(items, resize.id, resize.z) : null), [resize, items]);
  return { resize, preview, start };
}
