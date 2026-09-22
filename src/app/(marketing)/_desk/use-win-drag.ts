"use client";

import { useRef, useState, type Dispatch, type PointerEvent as RPointerEvent } from "react";
import { clampRect, type Rect } from "./geometry";
import type { Win, WinAction, WinState } from "./windows-state";

type Drag = {
  id: string; mode: "move" | "resize"; pid: number;
  sx: number; sy: number; ox: number; oy: number; ow: number; oh: number;
  left: number; top: number; moved: boolean; snap: Rect | null;
};

/**
 * 창 끌기·크기 조절. 포인터를 제목줄(또는 모서리)이 잡고(setPointerCapture) 그 요소가 move/up을 받는다.
 * 좌우 끝에 놓으면 반쪽, 위 끝이면 꽉 채움(스냅 미리보기 = ghost).
 */
export function useWinDrag(state: WinState, dispatch: Dispatch<WinAction>, onStart: () => void) {
  const drag = useRef<Drag | null>(null);
  const [ghost, setGhost] = useState<Rect | null>(null);
  const [snapping, setSnapping] = useState<string | null>(null);

  const down = (e: RPointerEvent<HTMLElement>, w: Win, mode: Drag["mode"]) => {
    if (state.mobile || e.button !== 0 || !state.geo) return;
    if ((e.target as HTMLElement).closest(".ctl")) return;
    e.preventDefault();
    onStart();
    const c = e.currentTarget.closest(".ws-canvas")!.getBoundingClientRect();
    drag.current = { id: w.id, mode, pid: e.pointerId, sx: e.clientX, sy: e.clientY, ox: w.x, oy: w.y, ow: w.w, oh: w.h, left: c.left, top: c.top, moved: false, snap: null };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const move = (e: RPointerEvent<HTMLElement>, w: Win) => {
    const d = drag.current, g = state.geo;
    if (!d || d.pid !== e.pointerId || !g) return;
    let dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
    d.moved = true;
    if (d.mode === "resize") { dispatch({ t: "place", id: d.id, rect: clampRect([w.x, w.y, d.ow + dx, d.oh + dy], g.W, g.H) }); return; }
    if (w.max) {
      // 꽉 찬 창을 끌면 원래 크기로 풀려 손끝 아래에서 따라온다.
      const p = w.prev ?? [0, 0, 420, 320];
      Object.assign(d, { ow: p[2], oh: p[3], ox: e.clientX - d.left - p[2] / 2, oy: 0, sx: e.clientX, sy: e.clientY });
      dx = 0; dy = 0;
      dispatch({ t: "place", id: d.id, rect: clampRect([d.ox, d.oy, d.ow, d.oh], g.W, g.H), max: false });
    } else dispatch({ t: "place", id: d.id, rect: clampRect([d.ox + dx, d.oy + dy, d.ow, d.oh], g.W, g.H) });
    const px = e.clientX - d.left, py = e.clientY - d.top;
    d.snap = px < 18 ? [0, 0, g.W / 2, g.H] : px > g.W - 18 ? [g.W / 2, 0, g.W / 2, g.H] : py < 10 ? [0, 0, g.W, g.H] : null;
    setGhost(d.snap);
  };

  const up = (e: RPointerEvent<HTMLElement>) => {
    const d = drag.current, g = state.geo;
    if (!d || d.pid !== e.pointerId) return;
    drag.current = null;
    setGhost(null);
    if (!d.snap || !g) return;
    const full = d.snap[2] === g.W;
    dispatch({ t: "place", id: d.id, rect: full ? d.snap : clampRect(d.snap, g.W, g.H), max: full, prev: [d.ox, d.oy, d.ow, d.oh] });
    setSnapping(d.id);
    setTimeout(() => setSnapping((s) => (s === d.id ? null : s)), 200);
  };

  return { down, move, up, ghost, snapping };
}
