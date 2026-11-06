import { splitSelKey } from "../../model";
import type { NetEngine } from "./engine";
import { netFitView, type NetCam } from "./graph";
import { easeOutCubic } from "./morph";

/**
 * 보기(배율·이동) 움직임(시안 `netAnimateView` · `zoomAt` · 전체 맞춤 · 선택 중심 · ResizeObserver 재맞춤) — 전부 부드럽게
 * (＋/− 320ms · 휠 160ms 목표 누적 · 전체 맞춤/선택 중심 450ms · 판 크기 변화 200ms). 전환 효과 생략이면 바로. 판 전환 중엔 받지 않는다.
 */

export function animateView(E: NetEngine, target: NetCam, ms = 320): void {
  const B = E.board;
  if (!B || E.morph) return;
  if (E.viewAnim) cancelAnimationFrame(E.viewAnim.raf);
  E.viewAnim = null;
  if (E.p.instant) {
    B.view = { ...target };
    return E.draw();
  }
  const from = { ...B.view };
  const t0 = performance.now();
  const anim = { raf: 0, target };
  const frame = (now: number) => {
    if (E.viewAnim !== anim || !E.board) return;
    const t = Math.min(1, (now - t0) / ms);
    const u = easeOutCubic(t);
    E.board.view = { k: from.k + (target.k - from.k) * u, x: from.x + (target.x - from.x) * u, y: from.y + (target.y - from.y) * u };
    E.draw();
    if (t < 1) anim.raf = requestAnimationFrame(frame);
    else E.viewAnim = null;
  };
  anim.raf = requestAnimationFrame(frame);
  E.viewAnim = anim;
}

/** 확대·축소 — 연속 휠은 목표를 쌓아 가며 따라간다(배율 0.05~12). */
export function zoomAt(E: NetEngine, f: number, x = E.size.w / 2, y = E.size.h / 2, ms = 320): void {
  if (E.morph || !E.board) return;
  const base = E.viewAnim ? E.viewAnim.target : E.board.view;
  const next = Math.max(0.05, Math.min(12, base.k * f));
  const ratio = next / base.k;
  animateView(E, { k: next, x: x - (x - base.x) * ratio, y: y - (y - base.y) * ratio }, ms);
}

export function fitAnimated(E: NetEngine): void {
  if (E.board) animateView(E, netFitView(E.board, E.size), 450);
}

/** 선택 중심 — 고른 기록(없으면 고른 영역)을 가운데로, 배율은 2배 이상. 고른 점이 없으면 false. */
export function centerOnSelection(E: NetEngine): boolean {
  const B = E.board;
  const { record, selected } = E.p;
  const id = record ?? (selected ? `hub:${splitSelKey(selected).sectorKey}` : null);
  if (!B || !id || !B.pos[id]) return false;
  const k = Math.max(B.view.k, 2);
  animateView(E, { k, x: E.size.w / 2 - B.pos[id].x * k, y: E.size.h / 2 - B.pos[id].y * k }, 450);
  return true;
}

/** 판 크기가 바뀌면(넓게 보기 등) 전체 맞춤을 부드럽게 따라간다 — 처음 관찰(크기 그대로)은 건너뛴다(되살린 보기를 지키게). */
export function resizeBoard(E: NetEngine): void {
  const s = E.measure();
  if (s.w === E.size.w && s.h === E.size.h) return;
  E.size = s;
  const B = E.board;
  if (!B) return;
  if (E.morph || E.p.instant) {
    B.view = netFitView(B, s);
    return E.draw();
  }
  animateView(E, netFitView(B, s), 200);
}
