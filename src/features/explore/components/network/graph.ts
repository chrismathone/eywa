import { partSelKey, type ExploreSector, type ExploreTarget } from "../../model";
import { netHubId, netRootId, netTargetId, ONTOLOGY_HUB, type NetBoard, type NetCam, type NetEdge, type NetGraph, type NetHead, type NetInput, type NetNeighbor, type NetNode, type NetPoint, type NetRecordInfo, type NetSize, type NetViewMode } from "./types";

export * from "./types";

/**
 * 연결 탐색 **네트워크 보기**의 판(그래프) — 순수 함수(서버·클라 겸용, `"use client"`/`server-only` 금지 — [[#61]]·[[#81]]).
 * 시안(:3978 `buildGraph` · `summaryGraph` · `netLayout` · `netRadius` · `netFitView`)을 그대로 옮겼다 — 숫자(반지름·거리·황금각)를 바꾸면
 * 원장이 다듬은 판 모양이 달라진다.
 *
 * 점 id 규약(중심 전환 보간의 축이 이 id로 두 판을 잇는다):
 *  · 가운데(뿌리) = `kind:id`(영역 중심이면 `kind:id:영역 key`) — 다른 판의 대상 점 id와 같아서 더블클릭한 대상 점이 그대로 새 가운데가 된다.
 *  · 영역 = `hub:<조각 key>` · 대상 = `kind:id`(여러 조각에 있으면 점 하나 + 선 여럿) · 기록 = `rec:<조각 key>:<줄 id>`
 *  · 분석 = `an:<id>` · 온톨로지 사실 = `fact:<id>`(영역 `hub:ontology` 아래).
 */

const mmdd = (d: string) => (/^\d{4}-\d{2}-\d{2}/.test(d) ? `${d.slice(5, 7)}.${d.slice(8, 10)}` : d);

function sectorMembers(s: ExploreSector): ExploreTarget[] {
  const all = [...(s.parts ?? []).map((p) => p.target), ...(s.targets ?? []), ...(s.groups ?? []).flatMap((g) => g.targets)];
  const seen = new Set<string>();
  return all.filter((t) => (seen.has(netTargetId(t)) ? false : (seen.add(netTargetId(t)), true)));
}

/** 모델 → 기록 단위의 온전한 판(점·선). 같은 대상은 점 하나로 합치고 조각마다 선을 잇는다. */
export function buildNetGraph(input: NetInput): NetGraph {
  const { model } = input;
  const nodes: NetNode[] = [];
  const edges: NetEdge[] = [];
  const byId = new Map<string, NetNode>();
  const linked = new Set<string>();
  const add = (n: NetNode) => byId.get(n.id) ?? (nodes.push(n), byId.set(n.id, n), n);
  const link = (a: string, b: string, rel: string) => {
    if (a === b || linked.has(`${a}|${b}`) || linked.has(`${b}|${a}`)) return;
    linked.add(`${a}|${b}`);
    edges.push({ from: a, to: b, rel });
  };
  const root = netRootId(model.center);
  add({ id: root, title: model.center.name, kind: "root", tone: "primary" });
  for (const s of model.sectors) {
    const hub = netHubId(s.key);
    const zoomKey = s.parts && s.parts.length > 0 ? partSelKey(s.key, s.parts[0].key) : s.key;
    add({ id: hub, title: s.label, kind: "hub", tone: s.tone, sectorKey: s.key, zoomKey, state: s.state });
    link(root, hub, s.label);
    const members = sectorMembers(s);
    for (const t of members) {
      const n = add({ id: netTargetId(t), title: t.label, kind: "target", tone: s.tone, hub, sectorKey: s.key, detail: [t.meta, t.detail].filter(Boolean).join(" · ") || null, target: t });
      link(hub, n.id, s.label);
    }
    const targetIds = new Set(members.map((t) => t.id));
    for (const r of s.rows ?? []) {
      if (targetIds.has(r.id)) continue; // 대상 점이 이미 그 줄을 맡는다(담당 수업 줄 = 수업 대상)
      const fromItems = !!(r.items && r.items.length > 0);
      for (const it of fromItems ? r.items! : [r]) {
        const id = `rec:${s.key}:${it.id}`;
        const title = fromItems && it.date ? `${mmdd(it.date)} ${it.title}` : it.title;
        add({ id, title, kind: "record", tone: s.tone, hub, sectorKey: s.key, rowId: it.id, date: it.date ?? null, detail: [it.right, it.detail].filter(Boolean).join(" · ") || null, body: it.body ?? null });
        link(hub, id, s.label);
      }
    }
  }
  const analyses = input.analyses ?? [];
  for (const a of analyses) {
    add({ id: `an:${a.id}`, title: a.title, kind: "analysis", tone: a.kind === "rule" ? "gold" : "primary", detail: a.detail, body: a.detail });
    link(root, `an:${a.id}`, "분석");
  }
  if (input.facts && input.facts.length > 0) {
    const hub = byId.has(ONTOLOGY_HUB) ? `${ONTOLOGY_HUB}~facts` : ONTOLOGY_HUB;
    add({ id: hub, title: "온톨로지 사실", kind: "hub", tone: "gold", virtual: true });
    link(root, hub, "온톨로지");
    for (const f of input.facts) {
      add({ id: `fact:${f.id}`, title: f.title, kind: "fact", tone: "gold", detail: f.detail, hub, target: f.target ?? null });
      link(hub, `fact:${f.id}`, "사실");
    }
  }
  // 분석의 근거 = 점 id · 조각 key(영역) · 줄 id(기록) · 대상 id 중 맞는 것 — 없으면 잇지 않는다(지어내지 않는다).
  for (const a of analyses)
    for (const e of a.evidence) {
      const hits = byId.has(e) ? [e] : byId.has(netHubId(e)) ? [netHubId(e)] : nodes.filter((n) => n.rowId === e || n.target?.id === e).map((n) => n.id);
      for (const id of hits) link(`an:${a.id}`, id, "근거");
    }
  return { nodes, edges };
}

/** 주체별 요약 — 영역을 기록 수만큼 큰 점으로, 영역 사이는 기록끼리의 교차 연결 수를 굵기(w)로(시안 `summaryGraph`). */
export function summaryGraph(g: NetGraph): NetGraph {
  const hubOf: Record<string, string> = {};
  const count: Record<string, number> = {};
  for (const n of g.nodes)
    if (n.hub) {
      hubOf[n.id] = n.hub;
      count[n.hub] = (count[n.hub] ?? 0) + 1;
    }
  const nodes = g.nodes.filter((n) => n.kind === "root" || n.kind === "hub" || n.kind === "analysis").map((n) => (n.kind === "hub" ? { ...n, count: count[n.id] ?? 0 } : n));
  const pair = new Map<string, NetEdge>();
  for (const e of g.edges) {
    const a = hubOf[e.from] ?? e.from;
    const b = hubOf[e.to] ?? e.to;
    if (a === b) continue;
    const [x, y] = a < b ? [a, b] : [b, a];
    const p = pair.get(`${x}|${y}`) ?? { from: x, to: y, rel: e.rel, w: 0 };
    p.w = (p.w ?? 0) + 1;
    pair.set(`${x}|${y}`, p);
  }
  return { nodes, edges: [...pair.values()] };
}

const GOLD = Math.PI * (3 - Math.sqrt(5));
const graphCache = new WeakMap<NetInput, NetGraph>();
/** 기록 단위 판 — 같은 입력은 한 번만 짠다(이웃·기록 찾기는 보기가 요약이어도 이것을 본다). */
export function fullGraphOf(input: NetInput): NetGraph {
  let g = graphCache.get(input);
  if (!g) graphCache.set(input, (g = buildNetGraph(input)));
  return g;
}

/** 판 배치(시안 `netLayout`) — 영역은 맨 위부터 고르게, 기록은 제 영역 둘레 황금각 나선, 분석은 가운데 둘레 110. 보기는 원점(맞춤은 `netFitView`). */
export function netLayout(input: NetInput, view: NetViewMode): NetBoard {
  const full = fullGraphOf(input);
  const { nodes, edges } = view === "summary" ? summaryGraph(full) : full;
  const centerId = netRootId(input.model.center);
  const pos: Record<string, NetPoint> = { [centerId]: { x: 0, y: 0 } };
  const hubs = nodes.filter((n) => n.kind === "hub");
  const R = 250;
  hubs.forEach((h, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / hubs.length;
    const members = nodes.filter((n) => n.hub === h.id);
    const r = R + Math.min(60, (h.count ?? members.length) * 1.2);
    pos[h.id] = { x: Math.cos(a) * r, y: Math.sin(a) * r };
    members.forEach((n, j) => {
      const rr = 22 + 7.5 * Math.sqrt(j + 1);
      const ang = a + j * GOLD;
      pos[n.id] = { x: pos[h.id].x + Math.cos(ang) * rr, y: pos[h.id].y + Math.sin(ang) * rr };
    });
  });
  nodes.filter((n) => n.kind === "analysis").forEach((n, i) => {
    const a = -Math.PI / 2 + Math.PI / 4 + (i * Math.PI) / 2;
    pos[n.id] = { x: Math.cos(a) * 110, y: Math.sin(a) * 110 };
  });
  for (const n of nodes) pos[n.id] ??= { x: 0, y: 0 };
  const adjacency = new Map(nodes.map((n) => [n.id, new Set<string>()]));
  for (const e of edges) {
    adjacency.get(e.from)?.add(e.to);
    adjacency.get(e.to)?.add(e.from);
  }
  return { centerId, mode: view, nodes, edges, pos, adjacency, view: { x: 0, y: 0, k: 1 }, hover: null };
}

/** 점 반지름(판 좌표) — 가운데 26 · 영역(요약 = 기록 수 · 기록 = 이웃 수) · 분석 7 · 기록 3.2. */
export function netRadius(n: NetNode, g: Pick<NetBoard, "adjacency">): number {
  if (n.kind === "root") return 26;
  if (n.kind === "hub") return n.count != null ? 12 + Math.min(26, Math.log2(n.count + 1) * 4.2) : 11 + Math.min(10, Math.log2((g.adjacency.get(n.id)?.size || 1) + 1) * 1.6);
  return n.kind === "analysis" ? 7 : 3.2;
}

/** 전체 맞춤 보기 — 좌우 60 · 위아래 45 여백, 배율 0.05~2.4. */
export function netFitView(g: Pick<NetBoard, "pos">, size: NetSize): NetCam {
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  for (const p of Object.values(g.pos)) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const k = Math.max(0.05, Math.min(2.4, (size.w - 120) / Math.max(100, maxX - minX), (size.h - 90) / Math.max(100, maxY - minY)));
  return { k, x: size.w / 2 - ((minX + maxX) / 2) * k, y: size.h / 2 - ((minY + maxY) / 2) * k };
}

/** 그 점에 이어진 기록·대상·분석(가운데·영역 제외) — 보기가 요약이어도 기록 판 기준(시안 `netNeighbors`). */
export function netNeighbors(input: NetInput, id: string): NetNeighbor[] {
  const g = fullGraphOf(input);
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const out: NetNeighbor[] = [];
  for (const e of g.edges) {
    const other = e.from === id ? e.to : e.to === id ? e.from : null;
    const n = other ? byId.get(other) : undefined;
    if (n && n.kind !== "root" && n.kind !== "hub") out.push({ id: n.id, title: n.title, rel: e.rel, tone: n.tone });
  }
  return out;
}

export function netRecordInfo(n: NetNode, g: Pick<NetBoard, "adjacency">): NetRecordInfo {
  if (n.kind === "hub") {
    const facts = Math.max(0, (g.adjacency.get(n.id)?.size ?? 1) - 1);
    return { id: n.id, kind: "fact", title: n.title, date: null, detail: `사실 ${facts}개`, body: null, sectorKey: "", target: null };
  }
  const kind = n.kind === "target" || n.kind === "analysis" || n.kind === "fact" ? n.kind : "record";
  return { id: n.id, kind, title: n.title, date: n.date ?? null, detail: n.detail ?? null, body: n.body ?? null, sectorKey: n.sectorKey ?? "", target: n.target ?? null };
}

/** 도구줄 머리 — '98개 기록 · 121개 연결선 · 중심 김서연' · 요약은 '11개 영역 · 26개 연결'. */
export const netHeadOf = (g: Pick<NetBoard, "mode" | "nodes" | "edges">, name: string): NetHead => ({
  mode: g.mode,
  nodes: g.nodes.length,
  hubs: g.nodes.filter((n) => n.kind === "hub").length,
  edges: g.edges.length,
  name,
});
