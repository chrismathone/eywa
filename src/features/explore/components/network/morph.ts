import type { NetBoard, NetCam, NetEdge, NetNode, NetPoint, NetSize } from "./graph";
import { netFitView, netRadius } from "./layout";

/**
 * 판 전환 보간(시안 `netMorphTo` · `netMorphBack`) — 순수 함수. `frame(u)`(u = 0~1, 이미 easing을 거친 값)가 그 순간의 점·선·자리·보기를 돌려준다.
 *  · 들어가기·보기 전환(`planMorphTo`) — 축 점이 제 화면 자리에서 출발 · 공통 점은 위치 보간 · 배율·이동은 새 판 전체 맞춤으로. 사라지는 기록은
 *    제 영역 안으로 빨려 들며 작아지고(흡수), 새 기록은 영역에서 퍼져 나온다. 영역이 없으면 축에서 피고 진다. 지금 판이 전환 중이던 프레임이면
 *    점의 불투명도·크기와 선 길이를 그 값에서 잇는다(이어받기).
 *  · 되돌아가기(`planMorphBack`) — 들어올 때의 진짜 역재생. 지금 중심은 왔던 점 자리로 미끄러져 돌아가고, 지금 판에만 있는 점은 피어났던 곳으로
 *    되감기며 작아지고, 돌아갈 판의 점은 사라졌던 자리에서 되살아난다. 선도 거꾸로. 끝 = 돌아갈 판 그대로(끌어 둔 자리·배율까지).
 */

export const NET_MORPH_MS = 760;
export const NET_VIEW_MS = 900;
/** 날짜 묶음 펼치기·접기 — 보기 전환보다 짧게(같은 판 안의 작은 변화). */
export const NET_TOGGLE_MS = 560;
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

export type NetFrame = { nodes: NetNode[]; edges: NetEdge[]; pos: Record<string, NetPoint>; view: NetCam };
export type NetPlan = { frame: (u: number) => NetFrame; end: NetBoard };

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const lerpP = (a: NetPoint, b: NetPoint, u: number): NetPoint => ({ x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u) });
const lerpCam = (a: NetCam, b: NetCam, u: number): NetCam => ({ k: lerp(a.k, b.k, u), x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u) });
/** 선 열쇠(from → to) — 대조는 Set·Map으로(선이 수천 개인 판에서 `some`/`find` 겹 반복은 전환마다 수십~수백 ms 멈춘다 · 지식그래프 전부 펼친 판). */
const edgeKey = (e: NetEdge) => `${e.from}\u0000${e.to}`;
const firstByKey = (edges: NetEdge[]) => {
  const m = new Map<string, NetEdge>();
  for (const e of edges) if (!m.has(edgeKey(e))) m.set(edgeKey(e), e);
  return m;
};

type Item =
  | { n: NetNode; gone: true; pos: NetPoint; hub: string | null; off: NetPoint | null; op0: number; s0: number }
  | { n: NetNode; gone: false; appear: boolean; hub: string | null; off: NetPoint | null; r0: number; op0: number };

/** 지금 판(old) → 다음 판(g2, 배치만) · 끝 보기 = g2 전체 맞춤(`endView`를 주면 그 보기 — 묶음 펼치기는 지금 보기 그대로). pivotOld = 지금 판의 축 점 · pivotNew = 다음 판의 축 점(보통 새 가운데). */
export function planMorphTo(old: NetBoard, g2: NetBoard, pivotOld: string | null, pivotNew: string | null, size: NetSize, endView?: NetCam): NetPlan {
  const C = { x: size.w / 2, y: size.h / 2 };
  const hasPivot = !!(pivotOld && old.pos[pivotOld]);
  const po = hasPivot ? old.pos[pivotOld!] : { x: 0, y: 0 };
  const pn = (pivotNew && g2.pos[pivotNew]) || { x: 0, y: 0 };
  const P = hasPivot ? { x: po.x * old.view.k + old.view.x, y: po.y * old.view.k + old.view.y } : C; // 축의 지금 화면 자리
  const shift = { x: pn.x - po.x, y: pn.y - po.y }; // 옛 좌표 → 새 좌표(축이 겹치게)
  const view0: NetCam = { k: old.view.k, x: P.x - pn.x * old.view.k, y: P.y - pn.y * old.view.k };
  const view1 = endView ?? netFitView(g2, size);
  const items: Item[] = [];
  const start: Record<string, NetPoint> = {};
  const oldById = new Map(old.nodes.map((n) => [n.id, n]));
  const both = (id: string | undefined) => (id && old.pos[id] && g2.pos[id] ? id : null);
  /** 피고 지는 기준 점 — 바로 위 점(날짜 묶음)이 두 판에 다 있으면 그 점, 아니면 영역. */
  const hubBoth = (n: NetNode) => both(n.parent) ?? both(n.hub);
  for (const n of g2.nodes) {
    const o = old.pos[n.id];
    const on = oldById.get(n.id);
    const hub = o ? null : hubBoth(n);
    start[n.id] = o ? { x: o.x + shift.x, y: o.y + shift.y } : hub ? { x: old.pos[hub].x + shift.x, y: old.pos[hub].y + shift.y } : { x: pn.x, y: pn.y };
    const off = hub ? { x: g2.pos[n.id].x - g2.pos[hub].x, y: g2.pos[n.id].y - g2.pos[hub].y } : null;
    const r0 = on ? (netRadius(on, old) * (on.rScale ?? 1)) / netRadius(n, g2) : 0.25;
    items.push({ n, gone: false, appear: !o, hub, off, r0, op0: on ? (on.op ?? 1) : 0 });
  }
  for (const n of old.nodes) {
    if (g2.pos[n.id]) continue;
    const hub = hubBoth(n);
    const p = { x: old.pos[n.id].x + shift.x, y: old.pos[n.id].y + shift.y };
    items.push({ n, gone: true, pos: p, hub, off: hub ? { x: p.x - (old.pos[hub].x + shift.x), y: p.y - (old.pos[hub].y + shift.y) } : null, op0: n.op ?? 1, s0: n.rScale ?? 1 });
  }
  const g2Keys = new Set(g2.edges.map(edgeKey));
  const oldByKey = firstByKey(old.edges);
  const oldE = old.edges.filter((e) => !g2Keys.has(edgeKey(e))).map((e) => ({ e, s: e.op ?? 1 }));
  const g2E = g2.edges.map((e) => {
    const f = oldByKey.get(edgeKey(e));
    return { e, s: f ? (f.op ?? 1) : 0 };
  });
  const frame = (u: number): NetFrame => {
    const pos: Record<string, NetPoint> = {};
    const nodes: NetNode[] = [];
    const hubAt = (id: string) => lerpP(start[id], g2.pos[id], u); // 영역의 지금 자리(공통 점이라 보간 중)
    for (const it of items) {
      if (it.gone) {
        if (it.hub && it.off) {
          const h = hubAt(it.hub);
          pos[it.n.id] = { x: h.x + it.off.x * (1 - u), y: h.y + it.off.y * (1 - u) };
          nodes.push({ ...it.n, op: it.op0 * (1 - u), rScale: it.s0 - (it.s0 - 0.25) * u });
        } else {
          pos[it.n.id] = it.pos;
          nodes.push({ ...it.n, op: it.op0 * (1 - u), rScale: it.s0 });
        }
        continue;
      }
      if (it.appear && it.hub && it.off) {
        const h = hubAt(it.hub);
        pos[it.n.id] = { x: h.x + it.off.x * u, y: h.y + it.off.y * u };
        nodes.push({ ...it.n, op: u, rScale: 0.25 + 0.75 * u });
        continue;
      }
      pos[it.n.id] = lerpP(start[it.n.id], g2.pos[it.n.id], u);
      nodes.push({ ...it.n, op: it.op0 + (1 - it.op0) * u, rScale: it.r0 + (1 - it.r0) * u });
    }
    const edges = [...oldE.map(({ e, s }) => ({ ...e, op: s * (1 - u) })), ...g2E.map(({ e, s }) => ({ ...e, op: s + (1 - s) * u }))];
    return { nodes, edges, pos, view: lerpCam(view0, view1, u) };
  };
  return { frame, end: { ...g2, view: view1, hover: null, morphing: false } };
}

/** 되돌아가기 — cur = 지금 판(끌어 둔 자리·배율에서 출발) · A = 돌아갈 판(끝 보기 포함) · pivotA = A에서 더블클릭했던 점 · pivotB = 지금 중심. */
export function planMorphBack(cur: NetBoard, A: NetBoard, pivotA: string | null, pivotB: string): NetPlan {
  const pa = pivotA ? A.pos[pivotA] : undefined;
  const pb = cur.pos[pivotB] ?? { x: 0, y: 0 };
  const shift = pa ? { x: pb.x - pa.x, y: pb.y - pa.y } : { x: 0, y: 0 }; // A 좌표 → 지금 좌표(들어올 때 밀었던 그대로)
  const view0 = { ...cur.view };
  const view1: NetCam = { k: A.view.k, x: A.view.x - shift.x * A.view.k, y: A.view.y - shift.y * A.view.k };
  const tgt = (id: string) => ({ x: A.pos[id].x + shift.x, y: A.pos[id].y + shift.y });
  const both = (id: string | undefined) => (id && A.pos[id] && cur.pos[id] ? id : null);
  const hubBoth = (n: NetNode) => both(n.parent) ?? both(n.hub);
  const curById = new Map(cur.nodes.map((n) => [n.id, n]));
  type Back = { n: NetNode; gone: boolean; from: NetPoint | null; to: NetPoint | null; hub: string | null; off: NetPoint | null; r0: number; sink: NetPoint | null };
  const items: Back[] = [];
  for (const n of A.nodes) {
    const c = cur.pos[n.id];
    const cn = c ? curById.get(n.id) : undefined;
    const hub = c ? null : hubBoth(n);
    items.push({ n, gone: false, from: c ? { ...c } : null, to: tgt(n.id), hub, off: hub ? { x: A.pos[n.id].x - A.pos[hub].x, y: A.pos[n.id].y - A.pos[hub].y } : null, r0: cn ? netRadius(cn, cur) / netRadius(n, A) : 1, sink: null });
  }
  for (const n of cur.nodes) {
    if (A.pos[n.id]) continue;
    const hub = hubBoth(n);
    const p = { ...cur.pos[n.id] };
    items.push({ n, gone: true, from: p, to: null, hub, off: hub ? { x: p.x - cur.pos[hub].x, y: p.y - cur.pos[hub].y } : null, r0: 1, sink: hub ? null : { ...pb } });
  }
  const aKeys = new Set(A.edges.map(edgeKey));
  const curEdges = cur.edges.filter((e) => !aKeys.has(edgeKey(e)));
  const frame = (u: number): NetFrame => {
    const pos: Record<string, NetPoint> = {};
    const nodes: NetNode[] = [];
    const hubAt = (id: string) => lerpP(cur.pos[id], tgt(id), u); // 양쪽에 있는 영역의 지금 자리
    for (const it of items) {
      if (it.gone) {
        if (it.hub && it.off) {
          const h = hubAt(it.hub);
          pos[it.n.id] = { x: h.x + it.off.x * (1 - u), y: h.y + it.off.y * (1 - u) };
        } else pos[it.n.id] = lerpP(it.from!, it.sink!, u);
        nodes.push({ ...it.n, op: 1 - u, rScale: 1 - 0.75 * u });
        continue;
      }
      if (!it.from) {
        if (it.hub && it.off) {
          const h = hubAt(it.hub);
          pos[it.n.id] = { x: h.x + it.off.x * u, y: h.y + it.off.y * u };
          nodes.push({ ...it.n, op: u, rScale: 0.25 + 0.75 * u });
        } else {
          pos[it.n.id] = it.to!;
          nodes.push({ ...it.n, op: u });
        }
        continue;
      }
      pos[it.n.id] = lerpP(it.from, it.to!, u);
      nodes.push({ ...it.n, rScale: it.r0 + (1 - it.r0) * u });
    }
    const edges = [...curEdges.map((e) => ({ ...e, op: 1 - u })), ...A.edges.map((e) => ({ ...e, op: u }))];
    return { nodes, edges, pos, view: lerpCam(view0, view1, u) };
  };
  return { frame, end: { ...A, hover: null, morphing: false } };
}
