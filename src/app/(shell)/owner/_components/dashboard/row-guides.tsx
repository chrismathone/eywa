"use client";

import { useLayoutEffect, useState, type RefObject } from "react";
import { emptyRowBands, insertGridRows, removeGridRows, rowBoundaries } from "@/features/dashboard/layout/grid-rows";
import type { Item } from "@/features/dashboard/layout/types";
import s from "./live-editor.module.css";

export type RowGeometry = { top: number; step: number; gap: number };

/** 캔버스 안 격자의 행 좌표 — 맨 위 행의 위치(캔버스 기준)·한 행 간격·행 사이 틈. 안내선과 우클릭 메뉴가 같은 값을 쓴다. */
export function useRowGeometry(root: RefObject<HTMLElement | null>, items: Item[]): RowGeometry {
  const [geometry, setGeometry] = useState<RowGeometry>({ top: 0, step: 80, gap: 16 });
  useLayoutEffect(() => {
    const host = root.current;
    const grid = host?.querySelector<HTMLElement>('[data-overview="free-grid"]');
    if (!host || !grid) return;
    const measure = () => {
      const gap = parseFloat(getComputedStyle(grid).rowGap) || 16;
      const next = { top: grid.getBoundingClientRect().top - host.getBoundingClientRect().top, step: 64 + gap, gap };
      setGeometry((old) => JSON.stringify(old) === JSON.stringify(next) ? old : next);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(host); observer.observe(grid); measure();
    return () => observer.disconnect();
  }, [root, items]);
  return geometry;
}

/** 행 경계 y의 캔버스 안 세로 위치(행 사이 틈의 가운데). */
export const boundaryTop = (g: RowGeometry, y: number) => g.top + y * g.step - g.gap / 2;

export function RowGuides({ geometry, items, onCommit, target }: { geometry: RowGeometry; items: Item[]; onCommit: (items: Item[]) => void; target?: number | null }) {
  const boundaries = rowBoundaries(items).filter((y) => y === 0 || items.some((i) => i.y === y || (i.y ?? 0) + i.h === y));
  return <div className={s.rowGuides}>
    {boundaries.map((y) => <div className={s.insertGuide} key={y} style={{ top: boundaryTop(geometry, y) }}>
      <button type="button" aria-label={`${y + 1}행 앞에 빈 행 4개 추가`} onClick={() => onCommit(insertGridRows(items, y, 4, `space:${crypto.randomUUID()}`))}>+ 행 추가</button>
    </div>)}
    {emptyRowBands(items).map((b) => <div className={s.emptyGuide} key={b.y} style={{ top: geometry.top + (b.y + b.h / 2) * geometry.step - geometry.gap / 2 }}>
      <span>빈 행 {b.h}개</span><button type="button" onClick={() => onCommit(removeGridRows(items, b.y, b.h))}>삭제하고 아래 카드 당기기</button>
    </div>)}
    {/* 우클릭 메뉴가 가리키는 경계 — 메뉴가 열린 동안만 굵은 선으로 보인다. */}
    {target != null ? <div className={s.targetLine} style={{ top: boundaryTop(geometry, target) }} aria-hidden /> : null}
  </div>;
}
