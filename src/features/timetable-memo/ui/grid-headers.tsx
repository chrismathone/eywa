"use client";

import type { PointerEvent } from "react";
import { colName, type Range } from "../doc";
import type { Layout } from "../geometry";
import { HEADER_H, RESIZE_GRIP, ROW_HEAD_W } from "./grid-dims";

/**
 * 열 이름 줄(A B C…) · 행 번호 칸(1 2 3…) — 엑셀처럼 고른 범위의 머리가 진하게 서고, 경계를 끌면 폭·높이가 바뀐다.
 * 두 머리는 판 스크롤 안에서 **고정(sticky)** 이다(오른쪽·아래로 굴려도 위치를 잃지 않는다).
 */

export type HeaderHandlers = {
  onSelect: (axis: "row" | "col", index: number, e: PointerEvent<HTMLElement>) => void;
  onResize: (axis: "row" | "col", index: number, e: PointerEvent<HTMLElement>) => void;
};

const BASE = "absolute top-0 flex items-center justify-center overflow-hidden text-xs select-none border-line border-r border-b";

/** 왼쪽 위 모서리 — 누르면 판 전체 선택(엑셀과 같다). */
export function HeaderCorner({ onSelectAll }: { onSelectAll: () => void }) {
  return (
    <div
      role="button"
      aria-label="전체 선택"
      className="bg-bg-soft border-line sticky top-0 left-0 z-30 border-r border-b"
      onPointerDown={(e) => {
        e.preventDefault();
        onSelectAll();
      }}
    />
  );
}

export function ColumnHeaders({ layout, range, full, handlers }: { layout: Layout; range: Range; full: boolean; handlers: HeaderHandlers }) {
  return (
    <div className="bg-bg-soft sticky top-0 z-20" style={{ height: HEADER_H, width: layout.width }}>
      {layout.colX.slice(0, -1).map((x, c) => {
        const on = c >= range.c0 && c <= range.c1;
        const w = layout.colX[c + 1]! - x;
        return (
          <div
            key={c}
            className={`${BASE} ${on ? (full ? "bg-primary text-primary-foreground font-bold" : "bg-primary-soft font-bold") : ""}`}
            style={{ left: x, width: w, height: HEADER_H }}
            onPointerDown={(e) => handlers.onSelect("col", c, e)}
          >
            {w >= 14 ? colName(c) : null}
            <span
              aria-hidden
              className="absolute top-0 right-0 h-full cursor-col-resize"
              style={{ width: RESIZE_GRIP }}
              onPointerDown={(e) => {
                e.stopPropagation();
                handlers.onResize("col", c, e);
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

export function RowHeaders({ layout, range, full, handlers }: { layout: Layout; range: Range; full: boolean; handlers: HeaderHandlers }) {
  return (
    <div className="bg-bg-soft sticky left-0 z-20" style={{ width: ROW_HEAD_W, height: layout.height }}>
      {layout.rowY.slice(0, -1).map((y, r) => {
        const on = r >= range.r0 && r <= range.r1;
        const h = layout.rowY[r + 1]! - y;
        return (
          <div
            key={r}
            className={`${BASE} left-0 ${on ? (full ? "bg-primary text-primary-foreground font-bold" : "bg-primary-soft font-bold") : ""}`}
            style={{ top: y, height: h, width: ROW_HEAD_W }}
            onPointerDown={(e) => handlers.onSelect("row", r, e)}
          >
            {h >= 12 ? r + 1 : null}
            <span
              aria-hidden
              className="absolute bottom-0 left-0 w-full cursor-row-resize"
              style={{ height: RESIZE_GRIP }}
              onPointerDown={(e) => {
                e.stopPropagation();
                handlers.onResize("row", r, e);
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
