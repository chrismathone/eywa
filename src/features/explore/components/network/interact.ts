import { zoomAt } from "./camera";
import type { NetEngine } from "./engine";
import { netRadius, type NetNode, type NetPoint } from "./graph";
import { hoverText, openNode, selectNode } from "./node-actions";

/**
 * 판 위 손짓(시안 `netBind` · `netSelect` · `netOpen`) — 끌어 이동 · 점 끌기 · 휠 확대 · hover 카드 · 한 번 클릭 = 고르기 · 두 번 = 중심으로 ·
 * 빈 곳 클릭 = 선택 해제. 🔑 더블클릭은 **포인터 두 번**으로 직접 판정한다(420ms · 8px · 같은 점) — 첫 클릭이 판을 다시 그려 브라우저의
 * click·dblclick이 안 생기는 일이 있어서(시안). 브라우저 dblclick이 오면(합성 이벤트 등) 같은 길로 간다.
 */

const DBL_MS = 420;
const DBL_PX = 8;

/** 판 위 손짓을 붙인다 — 돌려주는 함수 = 떼기. */
export function attachPointer(E: NetEngine): () => void {
  const svg = E.dom.svg;
  const card = E.dom.card;
  let drag: { id: string | null; x: number; y: number; sx: number; sy: number; moved: boolean } | null = null;
  let lastTap: { id: string; t: number; x: number; y: number } | null = null;
  const local = (e: { clientX: number; clientY: number }): NetPoint => {
    const r = svg.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (r.width ? svg.clientWidth / r.width : 1), y: (e.clientY - r.top) * (r.height ? svg.clientHeight / r.height : 1) };
  };
  const hit = (p: NetPoint): NetNode | null => {
    const B = E.board;
    if (!B) return null;
    let best: NetNode | null = null;
    let d0 = 1e9;
    for (const n of B.nodes) {
      const q = B.pos[n.id];
      if (!q) continue;
      const d = Math.hypot(q.x * B.view.k + B.view.x - p.x, q.y * B.view.k + B.view.y - p.y);
      const r = n.kind === "root" ? 26 : n.kind === "hub" ? netRadius(n, B) + 4 : n.kind === "analysis" ? 9 : 5;
      if (d < Math.max(7, r * Math.sqrt(B.view.k) + 3) && d < d0) {
        best = n;
        d0 = d;
      }
    }
    return best;
  };
  const showCard = (n: NetNode | null) => {
    if (!n || !E.board) return void (card.hidden = true);
    const [title, text] = [card.firstElementChild, card.lastElementChild];
    if (title) title.textContent = n.title;
    if (text) text.textContent = hoverText(n, E.board);
    card.hidden = false;
  };
  const down = (e: PointerEvent) => {
    if (e.button !== 0 || !E.board) return;
    const p = local(e);
    drag = { id: hit(p)?.id ?? null, x: p.x, y: p.y, sx: p.x, sy: p.y, moved: false };
    svg.setPointerCapture(e.pointerId);
    svg.classList.add(E.dom.cls.dragging);
  };
  const move = (e: PointerEvent) => {
    const B = E.board;
    if (!B) return;
    const p = local(e);
    if (drag) {
      const dx = p.x - drag.x;
      const dy = p.y - drag.y;
      drag.moved ||= Math.hypot(p.x - drag.sx, p.y - drag.sy) > 4;
      if (drag.moved) {
        const q = drag.id ? B.pos[drag.id] : null;
        if (q) {
          q.x += dx / B.view.k;
          q.y += dy / B.view.k;
        } else if (!drag.id) {
          B.view.x += dx;
          B.view.y += dy;
        }
        E.draw();
      }
      drag.x = p.x;
      drag.y = p.y;
      return;
    }
    if (E.frozen()) return;
    const n = hit(p);
    const id = n?.id ?? "";
    if (id === E.hoverId) return;
    E.hoverId = id;
    B.hover = id || null;
    svg.style.cursor = n ? "pointer" : "grab";
    showCard(n);
    E.draw();
  };
  const up = (e: PointerEvent) => {
    const prev = drag;
    drag = null;
    svg.classList.remove(E.dom.cls.dragging);
    if (svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
    const p = local(e);
    const now = performance.now();
    if (prev?.id && !prev.moved) {
      if (lastTap && lastTap.id === prev.id && now - lastTap.t < DBL_MS && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < DBL_PX) {
        lastTap = null;
        const n = E.board?.nodes.find((x) => x.id === prev.id);
        if (n) openNode(E, n);
      } else {
        lastTap = { id: prev.id, t: now, x: p.x, y: p.y };
        if (!E.frozen()) selectNode(E, prev.id);
      }
      return;
    }
    lastTap = null;
    // 빈 곳 클릭 = 선택 해제(끌어 이동은 제외)
    if (prev && !prev.id && !prev.moved && !E.frozen() && (E.p.record || E.p.selected)) {
      E.cb.onSelectRecord(null);
      E.cb.onSelectSector(null);
    }
  };
  const leave = () => {
    if (drag || !E.board) return;
    E.hoverId = "";
    E.board.hover = null;
    card.hidden = true;
    E.draw();
  };
  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    const p = local(e);
    zoomAt(E, Math.exp(-Math.max(-150, Math.min(150, e.deltaY)) * 0.002), p.x, p.y, 160);
  };
  const dbl = (e: MouseEvent) => {
    if (performance.now() - E.lastOpen < 600) return;
    const n = hit(local(e));
    if (n) openNode(E, n);
  };
  svg.addEventListener("pointerdown", down);
  svg.addEventListener("pointermove", move);
  svg.addEventListener("pointerup", up);
  svg.addEventListener("pointerleave", leave);
  svg.addEventListener("wheel", wheel, { passive: false });
  svg.addEventListener("dblclick", dbl);
  return () => {
    svg.removeEventListener("pointerdown", down);
    svg.removeEventListener("pointermove", move);
    svg.removeEventListener("pointerup", up);
    svg.removeEventListener("pointerleave", leave);
    svg.removeEventListener("wheel", wheel);
    svg.removeEventListener("dblclick", dbl);
  };
}
