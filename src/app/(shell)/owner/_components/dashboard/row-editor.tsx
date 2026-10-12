"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { emptyRowBands, insertGridRows, removeGridRows, rowBoundaries } from "@/features/dashboard/layout/grid-rows";
import type { Item } from "@/features/dashboard/layout/types";

/** 행 이동은 하나의 commit이므로 여러 카드를 함께 옮겨도 한 번에 되돌릴 수 있다. */
export function RowEditor({ items, onCommit }: { items: Item[]; onCommit: (items: Item[]) => void }) {
  const boundaries = rowBoundaries(items);
  const empty = emptyRowBands(items);
  const [at, setAt] = useState(0);
  const [count, setCount] = useState(4);
  const [gap, setGap] = useState(0);
  const currentAt = boundaries.includes(at) ? at : boundaries[0] ?? 0;
  const band = empty.find((b) => b.y === gap) ?? empty[0];
  return <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-background p-2" data-row-editor>
    <b className="mr-1 text-xs">행 편집</b>
    <select aria-label="행 추가 위치" className="h-8 rounded-md border px-2 text-xs" value={currentAt} onChange={(e) => setAt(Number(e.target.value))}>
      {boundaries.map((y) => <option key={y} value={y}>{y === 0 ? "맨 위" : `${y}행 다음`}</option>)}
    </select>
    <label className="flex items-center gap-1 text-xs"><input aria-label="추가할 행 수" type="number" min={1} max={32} value={count}
      className="h-8 w-14 rounded-md border px-2" onChange={(e) => setCount(Math.max(1, Math.min(32, Number(e.target.value) || 1)))} />행</label>
    <Button type="button" variant="outline" size="sm" onClick={() => onCommit(insertGridRows(items, currentAt, count, `space:${crypto.randomUUID()}`))}>여기에 행 추가</Button>
    {band ? <>
      <select aria-label="삭제할 빈 행" className="h-8 rounded-md border px-2 text-xs sm:ml-3" value={band.y} onChange={(e) => setGap(Number(e.target.value))}>
        {empty.map((b) => <option key={b.y} value={b.y}>{b.y + 1}–{b.y + b.h}행 · 빈 행 {b.h}개</option>)}
      </select>
      <Button type="button" variant="outline" size="sm" onClick={() => onCommit(removeGridRows(items, band.y, band.h))}>빈 행 삭제 · 아래 카드 당기기</Button>
    </> : null}
    <span className="text-muted-foreground text-xs">카드를 가로지르는 위치에는 행을 넣지 않습니다.</span>
  </div>;
}
