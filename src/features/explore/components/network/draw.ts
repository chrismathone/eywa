import type { NetBoard, NetNode } from "./graph";
import { netRadius } from "./layout";
import { placeLabels } from "./labels";

/**
 * 네트워크 판 그리기(시안 `netDraw` · `netLayers` · `netUpsert` · `netSweep`) — 브라우저 전용(DOM). React 밖에서 프레임마다 돈다.
 * 🔑 SVG 요소를 **재사용**한다(시안 원인 ②) — 매 프레임 innerHTML로 새로 만들지 않고, 같은 열쇠의 요소는 바뀐 속성만 쓴다. 층 = 선 · 점 · 이름.
 * 색은 전부 CSS 변수(`network.module.css`의 `--net-*`) — 흰 판/어두운 판은 변수 값만 바뀐다(디자인 lint: TS에 hex 금지).
 */

const SVG_NS = "http://www.w3.org/2000/svg";
type El = SVGElement & { __a?: Record<string, string>; __t?: string; __f?: number };
type Layers = { edges: SVGGElement; nodes: SVGGElement; labels: SVGGElement; map: Map<string, El>; frame: number };
const layerCache = new WeakMap<SVGSVGElement, Layers>();

function layersOf(svg: SVGSVGElement): Layers {
  const got = layerCache.get(svg);
  if (got && got.edges.parentNode === svg) return got;
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const mk = () => svg.appendChild(document.createElementNS(SVG_NS, "g")) as SVGGElement;
  const L: Layers = { edges: mk(), nodes: mk(), labels: mk(), map: new Map(), frame: 0 };
  layerCache.set(svg, L);
  return L;
}

type Attrs = Record<string, string | null | undefined>;
function upsert(L: Layers, layer: SVGGElement, key: string, tag: string, attrs: Attrs, text?: string): void {
  let el = L.map.get(key);
  if (!el || el.tagName !== tag || el.parentNode !== layer) {
    el?.remove();
    el = document.createElementNS(SVG_NS, tag) as El;
    el.__a = {};
    layer.appendChild(el);
    L.map.set(key, el);
  }
  const a = el.__a!;
  for (const k in a)
    if (attrs[k] == null || attrs[k] === "") {
      el.removeAttribute(k);
      delete a[k];
    }
  for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === "") continue;
    if (a[k] !== v) {
      el.setAttribute(k, v);
      a[k] = v;
    }
  }
  if (text !== undefined && el.__t !== text) {
    el.textContent = text;
    el.__t = text;
  }
  el.__f = L.frame;
}

function sweep(L: Layers): void {
  for (const [k, el] of L.map)
    if (el.__f !== L.frame) {
      el.remove();
      L.map.delete(k);
    }
}

export type DrawClasses = { node: string; nlabel: string; hub: string; root: string };
/** `size` = 판 크기(엔진이 든 값 — 그리는 중에 DOM 크기를 읽어 레이아웃을 강제하지 않는다). */
export type DrawOpts = { active: string | null; hubHover: boolean; colored: boolean; labels: boolean; dark: boolean; cls: DrawClasses; size: { w: number; h: number } };

const V = {
  edge: "var(--net-edge)",
  edgeHi: "var(--net-edge-hi)",
  edgeCross: "var(--net-edge-cross)",
  node: "var(--net-node)",
  near: "var(--net-node-near)",
  chosen: "var(--net-chosen)",
  rootFill: "var(--net-root-fill)",
  ring: "var(--net-ring)",
  lead: "var(--net-lead)",
  groupRing: "var(--net-group-ring)",
};
const tone = (n: NetNode) => `var(--net-t-${n.tone})`;
const tree = (id: string) => id.startsWith("hub:") || id.startsWith("grp:");
const f1 = (n: number) => n.toFixed(1);

/** 한 프레임을 그린다. 돌려주는 값 = 확대 비율 글('130%'). */
export function drawBoard(svg: SVGSVGElement, B: NetBoard, o: DrawOpts): string {
  const L = layersOf(svg);
  L.frame++;
  const { nodes, edges, pos, view, adjacency } = B;
  const active = o.active;
  const neighbors = active ? (adjacency.get(active) ?? null) : null;
  const sc = (id: string) => ({ x: pos[id].x * view.k + view.x, y: pos[id].y * view.k + view.y });
  const rad = (n: NetNode) => Math.max(2, netRadius(n, B) * (n.rScale ?? 1) * Math.sqrt(view.k));
  for (const e of edges) {
    if (!pos[e.from] || !pos[e.to]) continue;
    let a = sc(e.from);
    let b = sc(e.to);
    const ext = e.op ?? 1;
    if (ext < 1) {
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2; // 선은 가운데에서 양끝으로 그어지고 가운데로 지워진다
      a = { x: mx + (a.x - mx) * ext, y: my + (a.y - my) * ext };
      b = { x: mx + (b.x - mx) * ext, y: my + (b.y - my) * ext };
    }
    const hi = !!active && (e.from === active || e.to === active);
    // 교차 선(점선) = 영역·날짜 묶음·가운데를 거치지 않는 선(분석 근거 등) — 묶음 아래 기록 선은 자리 선이다.
    const cross = !tree(e.from) && !tree(e.to) && e.from !== B.centerId && e.to !== B.centerId;
    const so = (active ? (hi ? 0.85 : 0.06) : cross ? 0.5 : o.dark ? 0.55 : 0.28) * Math.sqrt(ext);
    upsert(L, L.edges, `e:${e.from}|${e.to}`, "line", {
      x1: f1(a.x), y1: f1(a.y), x2: f1(b.x), y2: f1(b.y),
      stroke: hi ? V.edgeHi : cross ? V.edgeCross : V.edge,
      "stroke-opacity": so.toFixed(3),
      "stroke-width": ((hi ? 1.6 : cross ? 1.1 : 0.9) * (e.w ? 1 + Math.log2(e.w + 1) * 0.8 : 1)).toFixed(2),
      "stroke-dasharray": cross && !hi ? "3 3" : "",
    });
  }
  for (const n of nodes) {
    if (!pos[n.id]) continue;
    const p = sc(n.id);
    const r = rad(n);
    const chosen = n.id === active;
    const near = !!neighbors?.has(n.id);
    const color = tone(n);
    const fill = chosen ? V.chosen : n.kind === "root" ? V.rootFill : o.colored || n.kind === "hub" || n.kind === "analysis" || n.kind === "group" ? color : near ? V.near : V.node;
    const op = ((active && !chosen && !near ? 0.18 : 1) * (n.op ?? 1)).toFixed(3);
    if (n.kind === "analysis")
      upsert(L, L.nodes, `n:${n.id}`, "path", {
        class: o.cls.node, "data-id": n.id,
        d: `M ${f1(p.x)} ${f1(p.y - r * 1.3)} L ${f1(p.x + r * 1.3)} ${f1(p.y)} L ${f1(p.x)} ${f1(p.y + r * 1.3)} L ${f1(p.x - r * 1.3)} ${f1(p.y)} Z`,
        fill, "fill-opacity": op, stroke: chosen ? V.ring : color, "stroke-opacity": op, "stroke-width": "1.2",
      });
    else
      upsert(L, L.nodes, `n:${n.id}`, "circle", {
        class: o.cls.node, "data-id": n.id, cx: f1(p.x), cy: f1(p.y), r: f1(r),
        fill, "fill-opacity": op, "stroke-opacity": op,
        // 날짜 묶음 = 영역 색 + 흰 테(기록 점과 구별 · 큰 영역 점보다 작다).
        stroke: n.kind === "root" || chosen ? V.ring : n.kind === "group" ? V.groupRing : "",
        "stroke-width": n.kind === "root" ? "3" : chosen ? "2" : n.kind === "group" ? "1.5" : "",
      });
    if (chosen) upsert(L, L.nodes, `ring:${n.id}`, "circle", { cx: f1(p.x), cy: f1(p.y), r: f1(r + 3), fill: "none", stroke: V.ring, "stroke-width": "1" });
  }
  const placed = placeLabels({
    nodes,
    at: (id) => (pos[id] ? sc(id) : null),
    radius: rad,
    active,
    neighbors,
    hubHover: o.hubHover,
    showAll: o.labels,
    k: view.k,
    dark: o.dark,
    centerId: B.centerId,
    bounds: o.size.w > 0 ? o.size : undefined,
  });
  for (const t of placed) {
    if (t.lead) upsert(L, L.labels, `lead:${t.id}`, "line", { x1: f1(t.lead.x1), y1: f1(t.lead.y1), x2: f1(t.lead.x2), y2: f1(t.lead.y2), stroke: V.lead, "stroke-width": "1", opacity: t.opacity });
    const cls = `${o.cls.nlabel} ${t.cls === "hub" ? o.cls.hub : t.cls === "root" ? o.cls.root : ""}`.trim();
    upsert(L, L.labels, `label:${t.id}`, "text", { class: cls, "data-label": t.id, x: f1(t.x), y: f1(t.y), "text-anchor": t.anchor, "font-weight": t.bold ? "800" : "", opacity: t.opacity }, t.text);
  }
  if (!nodes.length) upsert(L, L.labels, "empty", "text", { class: o.cls.nlabel, x: "50%", y: "50%", "text-anchor": "middle" }, "현재 보기에서 표시할 기록이 없습니다");
  sweep(L);
  return `${Math.round(view.k * 100)}%`;
}
