"use client";

import { memo, type CSSProperties } from "react";
import { cellKey, type BorderLine, type Cell, type Merge, type SheetDoc } from "../doc";
import type { Layout } from "../geometry";
import { fontStyle } from "../style-css";

/**
 * 판 그림 — 격자선 · 채우기 · 테두리는 **SVG 한 장**, 글자는 그 위 HTML 층.
 * 순서가 곧 규칙이다: 채우기가 격자선을 덮고(엑셀·구글 시트처럼 색 칸엔 격자선이 안 보인다), 글자는 옆 빈 칸
 * 위로 넘쳐 보인다(넘침 칸). 선택·편집은 이 위의 다른 층이라 **문서가 바뀔 때만** 다시 그린다(memo).
 */

const GRID_LINE = "#e2e3e3";
/** 넘침 글자가 옆 빈 칸을 빌려 쓰는 상한(칸 수) — 끝없이 긴 글자가 판 끝까지 그리지 않게. */
const OVERFLOW_SCAN = 30;

type Seg = { x0: number; y0: number; x1: number; y1: number };

function lineKey(l: BorderLine) {
  return `${l.c}|${l.w}|${l.s}`;
}

function dash(s: BorderLine["s"]): string | undefined {
  return s === "dashed" ? "4 2" : s === "dotted" ? "1 2" : undefined;
}

/** 칸 경계 좌표에 선 두께를 얹은 중심선 — 1px 선은 경계 바로 안쪽 픽셀(격자선과 같은 자리)에 선다. */
function offset(w: number): number {
  return w === 2 ? 0 : w === 3 ? -0.5 : -0.5;
}

function GridBaseImpl({ doc, layout, merges }: { doc: SheetDoc; layout: Layout; merges: Map<string, Merge> }) {
  const { colX, rowY, width, height } = layout;
  const covered = (r: number, c: number) => {
    const m = merges.get(cellKey(r, c));
    return !!m && (m.r !== r || m.c !== c);
  };

  let grid = "";
  for (let i = 1; i < colX.length; i++) grid += `M${colX[i]! - 0.5} 0V${height}`;
  for (let i = 1; i < rowY.length; i++) grid += `M0 ${rowY[i]! - 0.5}H${width}`;

  const fills: { x: number; y: number; w: number; h: number; c: string }[] = [];
  const segs = new Map<string, { line: BorderLine; segs: Seg[]; seen: Set<string> }>();
  const texts: { key: string; cell: Cell; r: number; c: number; m: Merge | undefined }[] = [];

  const addSeg = (line: BorderLine, s: Seg) => {
    const k = lineKey(line);
    const g = segs.get(k) ?? { line, segs: [], seen: new Set<string>() };
    segs.set(k, g);
    const id = `${s.x0},${s.y0},${s.x1},${s.y1}`;
    if (g.seen.has(id)) return;
    g.seen.add(id);
    g.segs.push(s);
  };

  // 병합 덩어리는 색이 없어도 흰 판으로 덮는다(안쪽 격자선이 비치지 않게).
  for (const m of doc.merges) {
    const x = colX[m.c]!;
    const y = rowY[m.r]!;
    const bg = doc.cells[cellKey(m.r, m.c)]?.s?.bg ?? "#ffffff";
    fills.push({ x, y, w: colX[m.c + m.cs]! - x, h: rowY[m.r + m.rs]! - y, c: bg });
  }

  for (const [key, cell] of Object.entries(doc.cells)) {
    const [r, c] = key.split(",").map(Number) as [number, number];
    if (r >= doc.rows || c >= doc.cols) continue;
    const m = merges.get(key);
    const isCovered = !!m && (m.r !== r || m.c !== c);
    if (!m && cell.s?.bg) {
      fills.push({ x: colX[c]!, y: rowY[r]!, w: colX[c + 1]! - colX[c]!, h: rowY[r + 1]! - rowY[r]!, c: cell.s.bg });
    }
    const bd = cell.s?.bd;
    if (bd) {
      // 병합 속 칸은 덩어리 바깥 변만 그린다.
      const onTop = !m || r === m.r;
      const onBottom = !m || r === m.r + m.rs - 1;
      const onLeft = !m || c === m.c;
      const onRight = !m || c === m.c + m.cs - 1;
      const x0 = colX[c]!;
      const x1 = colX[c + 1]!;
      const y0 = rowY[r]!;
      const y1 = rowY[r + 1]!;
      if (bd.t && onTop) addSeg(bd.t, { x0: x0 - 1, y0, x1, y1: y0 });
      if (bd.b && onBottom) addSeg(bd.b, { x0: x0 - 1, y0: y1, x1, y1 });
      if (bd.l && onLeft) addSeg(bd.l, { x0, y0: y0 - 1, x1: x0, y1 });
      if (bd.r && onRight) addSeg(bd.r, { x0: x1, y0: y0 - 1, x1, y1 });
    }
    if (cell.t && !isCovered) texts.push({ key, cell, r, c, m });
  }

  const hasText = (r: number, c: number) => !!doc.cells[cellKey(r, c)]?.t || merges.has(cellKey(r, c));

  return (
    <>
      <svg width={width} height={height} className="pointer-events-none absolute top-0 left-0" aria-hidden shapeRendering="crispEdges">
        <path d={grid} stroke={GRID_LINE} strokeWidth={1} fill="none" />
        {fills.map((f, i) => (
          <rect key={i} x={f.x} y={f.y} width={f.w} height={f.h} fill={f.c} />
        ))}
        {[...segs.values()].map(({ line, segs: list }) => {
          const o = offset(line.w);
          const d = list
            .map((s) => (s.y0 === s.y1 ? `M${s.x0} ${s.y0 + o}H${s.x1}` : `M${s.x0 + o} ${s.y0}V${s.y1}`))
            .join("");
          return (
            <path
              key={lineKey(line)}
              d={d}
              stroke={line.c}
              strokeWidth={line.s === "double" ? 3 : line.w}
              strokeDasharray={dash(line.s)}
              fill="none"
            />
          );
        })}
      </svg>
      {texts.map(({ key, cell, r, c, m }) => {
        const s = cell.s;
        const r1 = m ? m.r + m.rs : r + 1;
        const c1 = m ? m.c + m.cs : c + 1;
        let x0 = colX[c]!;
        let x1 = colX[c1]!;
        const ha = s?.ha ?? "left";
        const wrap = s?.wr ?? "overflow";
        // 넘침 칸 — 글자가 넘쳐 나갈 쪽의 옆 칸이 비어 있는 만큼만 빌린다(구글 시트와 같다).
        if (wrap === "overflow" && !m) {
          let right = 0;
          let left = 0;
          if (ha !== "right") for (let j = c + 1; j < Math.min(doc.cols, c + OVERFLOW_SCAN) && !hasText(r, j) && !covered(r, j); j++) right++;
          if (ha !== "left") for (let j = c - 1; j >= Math.max(0, c - OVERFLOW_SCAN) && !hasText(r, j) && !covered(r, j); j--) left++;
          if (ha === "center") {
            const extra = Math.min(colX[c + 1 + right]! - colX[c + 1]!, colX[c]! - colX[c - left]!);
            x0 -= extra;
            x1 += extra;
          } else {
            x1 = colX[c + 1 + right]!;
            x0 = colX[c - left]!;
          }
        }
        const box: CSSProperties = {
          left: x0,
          top: rowY[r]!,
          width: x1 - x0,
          height: rowY[r1]! - rowY[r]!,
          justifyContent: ha === "center" ? "center" : ha === "right" ? "flex-end" : "flex-start",
          // `safe` — 글자가 칸보다 높으면 위부터 보인다(구글 시트와 같다: 줄바꿈 칸이 넘치면 아래가 잘린다).
          alignItems: s?.va === "top" ? "flex-start" : s?.va === "middle" ? "safe center" : "safe flex-end",
          ...fontStyle(s),
        };
        return (
          <div key={key} className="pointer-events-none absolute flex overflow-hidden px-[3px] py-[2px]" style={box}>
            <span
              className={wrap === "wrap" ? "max-w-full break-keep whitespace-pre-wrap [overflow-wrap:anywhere]" : "whitespace-pre"}
              style={{ textAlign: ha, lineHeight: 1.15 }}
            >
              {cell.t}
            </span>
          </div>
        );
      })}
    </>
  );
}

/** 문서·좌표·병합 지도가 같으면 다시 그리지 않는다(선택·편집이 바뀌어도 그대로). */
export const GridBase = memo(GridBaseImpl);
