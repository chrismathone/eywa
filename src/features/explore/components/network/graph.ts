import { partSelKey } from "../../model";
import { claimsOf, hubOpen, leafRows, sectorMembers, selfRow } from "./graph-rules";
import { recordYmd, timeTree } from "./time-tree";
import { netHubId, netRootId, netTargetId, ONTOLOGY_HUB, type NetBoard, type NetEdge, type NetGraph, type NetHead, type NetInput, type NetNeighbor, type NetNode, type NetRecordInfo } from "./types";

export * from "./types";

/**
 * 연결 탐색 **네트워크 보기**의 판(그래프) — 순수 함수(서버·클라 겸용, `"use client"`/`server-only` 금지 — [[#61]]·[[#81]]).
 * 시안(:3978 `buildGraph` · `summaryGraph`)을 옮기고, 원장 2026-11-06 검수로 기록 점을 정리했다:
 *  · 날짜 있는 기록 = 영역 아래 **연도 → 월 → (같은 날 여럿이면) 일자** 묶음([`time-tree.ts`](./time-tree.ts)).
 *  · 영역 중심(2단계)에서 같은 기록이 여러 영역에 들면(출결 '출석 횟수'·'기록'·'출석') **가장 좁은 영역 하나**에만 세운다.
 *  · 대상이 있는 영역의 설명 줄(강의실 = 교시마다 방) · 대상 조각의 소개 줄(학교학년) · 줄 하나짜리 조각의 같은 줄은 점으로 세우지 않는다(되풀이).
 *  · 값이 있는 통계 줄은 이름에 값까지('총 청구 5건') · `items: []`(셀 수 있는데 0건)인 줄은 점이 없다.
 * 규칙 함수는 [`graph-rules.ts`](./graph-rules.ts) · 배치·반지름·맞춤 보기는 [`layout.ts`](./layout.ts).
 *
 * 점 id 규약(중심 전환 보간의 축이 이 id로 두 판을 잇는다):
 *  · 가운데(뿌리) = `kind:id`(영역 중심이면 `kind:id:영역 key`) — 다른 판의 대상 점 id와 같아서 더블클릭한 대상 점이 그대로 새 가운데가 된다.
 *  · 영역 = `hub:<조각 key>` · 대상 = `kind:id`(여러 조각에 있으면 점 하나 + 선 여럿) · 기록 = `rec:<조각 key>:<줄 id>` · 날짜 묶음 = `grp:<조각 key>:<기간>`
 *  · 분석 = `an:<id>` · 온톨로지 사실 = `fact:<id>`(영역 `hub:ontology` 아래).
 */

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
  const claims = claimsOf(model);
  const labelOf = new Map(model.sectors.map((s) => [s.key, s.label]));
  // 영역 중심의 대상 조각(그 대상 자체가 조각)은 '나머지' 조각의 목록에서 다시 세우지 않는다.
  const focusIds = new Set(model.sectors.flatMap((s) => (s.focus ? [netTargetId(s.focus)] : [])));
  const dated = new Map<string, NetNode[]>();
  for (const s of model.sectors) {
    const hub = netHubId(s.key);
    const zoomKey = s.parts && s.parts.length > 0 ? partSelKey(s.key, s.parts[0].key) : s.key;
    const own = selfRow(s);
    const h = add({ id: hub, title: s.label, kind: "hub", tone: s.tone, sectorKey: s.key, zoomKey, state: s.state, summary: s.summary || null, ...hubOpen(model, zoomKey) });
    if (own) Object.assign(h, { self: true, date: own.date ?? null, detail: [own.right, own.detail].filter(Boolean).join(" · ") || null, body: own.body ?? null });
    link(root, hub, s.label);
    const members = sectorMembers(s, s.focus ? new Set() : focusIds);
    for (const t of members) {
      const n = add({ id: netTargetId(t), title: t.label, kind: "target", tone: s.tone, hub, sectorKey: s.key, detail: [t.meta, t.detail].filter(Boolean).join(" · ") || null, target: t });
      link(hub, n.id, s.label);
    }
    if (own) continue; // 조각 = 그 기록 하나 — 같은 점을 한 번 더 세우지 않는다
    const targetIds = new Set(members.map((t) => t.id));
    const moved = new Set<string>();
    let movedN = 0;
    for (const r of s.rows ?? []) {
      if (targetIds.has(r.id)) continue; // 대상 점이 이미 그 줄을 맡는다(담당 수업 줄 = 수업 대상)
      if (s.focus && r.id === "about") continue; // 대상 소개(학교학년 · 관계)는 그 조각 점의 hover가 말한다
      if (members.length > 0 && !r.items && !recordYmd(r.date)) continue; // 대상의 설명 줄(교시마다 방)은 대상 점이 맡는다
      for (const it of leafRows(r)) {
        const owner = s.focus ? s.key : (claims?.get(it.id) ?? s.key);
        if (owner !== s.key) {
          moved.add(labelOf.get(owner) ?? owner);
          movedN++;
          continue;
        }
        const id = `rec:${s.key}:${it.id}`;
        if (byId.has(id)) continue;
        const date = recordYmd(it.date);
        const label = !date && it.right ? `${it.title} ${it.right}` : undefined;
        const n = add({ id, title: it.title, label, kind: "record", tone: s.tone, hub, sectorKey: s.key, rowId: it.id, date: it.date ?? null, detail: [it.right, it.detail].filter(Boolean).join(" · ") || null, body: it.body ?? null });
        if (date) dated.set(hub, [...(dated.get(hub) ?? []), n]);
        else link(hub, id, s.label);
      }
    }
    if (moved.size > 0) Object.assign(h, { movedTo: [...moved], moved: movedN });
  }
  for (const [hub, recs] of dated) {
    const t = timeTree(byId.get(hub)!, recs);
    for (const g of t.groups) add(g);
    for (const e of t.edges) link(e.from, e.to, e.rel);
  }
  // 영역의 수 — 날짜 기록(묶음의 'N건'과 같은 수) · 날짜 없는 항목(통계·속성 줄) · 연결(대상)을 따로 센다.
  for (const n of nodes)
    if (n.kind === "hub") {
      const under = nodes.filter((x) => x.hub === n.id);
      Object.assign(n, { tally: under.filter((x) => x.kind === "record" && x.parent).length, items: under.filter((x) => x.kind === "record" && !x.parent).length, members: under.filter((x) => x.kind === "target").length });
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

/** 주체별 요약 — 영역을 기록 수만큼 큰 점으로, 영역 사이는 기록끼리의 교차 연결 수를 굵기(w)로(시안 `summaryGraph`). 날짜 묶음은 세지 않는다. */
export function summaryGraph(g: NetGraph): NetGraph {
  const hubOf: Record<string, string> = {};
  const count: Record<string, number> = {};
  for (const n of g.nodes)
    if (n.hub) {
      hubOf[n.id] = n.hub;
      if (n.kind !== "group") count[n.hub] = (count[n.hub] ?? 0) + 1;
    }
  // 영역 크기 = 그 영역의 기록 — 영역 중심에서 더 좁은 영역으로 옮겨 선 기록 · 조각 자체인 기록도 그 영역 몫으로 센다(요약 판이 '0'이 되지 않게).
  const nodes = g.nodes.filter((n) => n.kind === "root" || n.kind === "hub" || n.kind === "analysis").map((n) => (n.kind === "hub" ? { ...n, count: (count[n.id] ?? 0) + (n.moved ?? 0) + (n.self ? 1 : 0) } : n));
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

const graphCache = new WeakMap<NetInput, NetGraph>();
/** 기록 단위 판 — 같은 입력은 한 번만 짠다(이웃·기록 찾기는 보기가 요약이어도 이것을 본다). */
export function fullGraphOf(input: NetInput): NetGraph {
  let g = graphCache.get(input);
  if (!g) graphCache.set(input, (g = buildNetGraph(input)));
  return g;
}

/**
 * 그 점에 이어진 것 — 기록 판 기준(요약이어도 · 시안 `netNeighbors`). 날짜 묶음이면 **그 아래 든 것**(최근 먼저), 그 밖은 가운데·영역·묶음을 뺀
 * 기록·대상·분석(묶음 아래 기록의 '위'는 이어진 것이 아니라 자리다).
 */
const UNIT = { year: "연도", month: "월", day: "일자" } as const;
export function netNeighbors(input: NetInput, id: string): NetNeighbor[] {
  const g = fullGraphOf(input);
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const me = byId.get(id);
  if (me?.kind === "group")
    return g.edges
      .filter((e) => e.from === id)
      .map((e) => byId.get(e.to)!)
      .filter(Boolean)
      .map((n) => ({ id: n.id, title: n.label ?? n.title, rel: n.kind === "group" ? "" : (n.detail?.split(" · ")[0] ?? ""), tone: n.tone, date: n.date ?? null, ...(n.level ? { unit: UNIT[n.level] } : {}) }));
  const out: NetNeighbor[] = [];
  for (const e of g.edges) {
    const other = e.from === id ? e.to : e.to === id ? e.from : null;
    const n = other ? byId.get(other) : undefined;
    if (n && n.kind !== "root" && n.kind !== "hub" && n.kind !== "group") out.push({ id: n.id, title: n.title, rel: e.rel, tone: n.tone, date: n.date ?? null });
  }
  return out;
}

export function netRecordInfo(n: NetNode, g: Pick<NetBoard, "adjacency">): NetRecordInfo {
  if (n.kind === "hub") {
    const facts = Math.max(0, (g.adjacency.get(n.id)?.size ?? 1) - 1);
    return { id: n.id, kind: "fact", title: n.title, date: null, detail: `사실 ${facts}개`, body: null, sectorKey: "", target: null };
  }
  if (n.kind === "group") return { id: n.id, kind: "group", title: n.title, date: null, detail: `기록 ${n.tally ?? 0}건`, body: null, sectorKey: n.sectorKey ?? "", target: null };
  const kind = n.kind === "target" || n.kind === "analysis" || n.kind === "fact" ? n.kind : "record";
  return { id: n.id, kind, title: n.title, date: n.date ?? null, detail: n.detail ?? null, body: n.body ?? null, sectorKey: n.sectorKey ?? "", target: n.target ?? null };
}

/**
 * 도구줄 머리 — '27개 기록 · 40개 연결선 · 중심 김서연' · 요약은 '11개 영역 · 26개 연결'. 기록 판의 두 수는 **접어 둔 묶음 안까지** 온전한 판에서
 * 센다(`full` — 펼치고 접어도 같은 수): 기록 = 기록·대상·분석·사실 + 조각 자체인 기록(영역 중심의 상담 한 건 등) · 연결선 = 모든 선.
 */
export const netHeadOf = (g: Pick<NetBoard, "mode" | "nodes" | "edges">, name: string, full?: Pick<NetGraph, "nodes" | "edges">): NetHead => {
  const src = g.mode === "records" && full ? full : g;
  return {
    mode: g.mode,
    nodes: (full ?? g).nodes.filter((n) => n.kind === "record" || n.kind === "target" || n.kind === "analysis" || n.kind === "fact" || n.self).length,
    hubs: g.nodes.filter((n) => n.kind === "hub").length,
    edges: src.edges.length,
    name,
  };
};
