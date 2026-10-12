"use client";

import { useLayoutEffect, useState, type RefObject } from "react";
import type { Item } from "@/features/dashboard/layout/types";
import { GRID_COLS } from "@/features/dashboard/layout/types";
import { type BoardLayout, type Rect } from "./geometry";

export type LiveCard = { id: string; rect: Rect };

/** 실제 대시보드의 카드 경계를 잰다. 편집용 격자·높이를 따로 만들지 않는다. */
export function useLiveLayout(rootRef: RefObject<HTMLDivElement | null>, items: readonly Item[], layoutRef: RefObject<BoardLayout | null>) {
  const [cards, setCards] = useState<LiveCard[]>([]);
  useLayoutEffect(() => {
    const root = rootRef.current;
    const preview = root?.querySelector<HTMLElement>("[data-live-preview]");
    if (!root || !preview) return;
    let raf = 0;
    const measure = () => {
      const origin = root.getBoundingClientRect();
      const rects = new Map<string, Rect>();
      for (const el of preview.querySelectorAll<HTMLElement>("[data-dashboard-card]")) {
        const id = el.dataset.dashboardCard!;
        // 자유 격자의 바깥 칸을 사용한다(안쪽 실제 카드에도 같은 식별자가 있다).
        if (rects.has(id)) continue;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        rects.set(id, { left: r.left - origin.left, top: r.top - origin.top, width: r.width, height: r.height });
      }
      const next = items.flatMap(({ id }) => rects.has(id) ? [{ id, rect: rects.get(id)! }] : []);
      const grid = preview.querySelector<HTMLElement>('[data-overview="free-grid"], [data-overview="grid"], [data-overview="kpis"]');
      const gap = grid ? parseFloat(getComputedStyle(grid).columnGap) || 16 : 16;
      const width = grid?.getBoundingClientRect().width ?? origin.width;
      const overviewWidth = preview.querySelector('[data-overview="root"]')?.getBoundingClientRect().width ?? width;
      const free = !!preview.querySelector('[data-overview="free-grid"]');
      const columnScale = grid?.dataset.fixedGrid ? 1 : free && overviewWidth <= 1100 ? 2 : 1;
      // 키보드 위/아래 이동도 실제 화면 좌표에서 이웃을 찾는다.
      layoutRef.current = {
        placed: next.map(({ id, rect: r }) => ({ id, x: r.left, y: r.top, w: r.width, h: r.height })),
        rects, columnScale,
        metrics: { colStep: (width + gap) / GRID_COLS, rowTops: [], rowHeights: [], height: origin.height },
      };
      setCards((prev) => JSON.stringify(prev) === JSON.stringify(next) ? prev : next);
    };
    const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measure); };
    const resize = new ResizeObserver(schedule);
    const observeCards = () => {
      resize.disconnect();
      resize.observe(preview);
      preview.querySelectorAll('[data-dashboard-card]').forEach((el) => resize.observe(el));
      schedule();
    };
    const mutations = new MutationObserver(observeCards);
    mutations.observe(preview, { subtree: true, childList: true, characterData: true });
    observeCards();
    return () => { cancelAnimationFrame(raf); mutations.disconnect(); resize.disconnect(); };
  }, [rootRef, items, layoutRef]);
  return cards;
}
