import { entities, type Entity } from "./catalog";
import { degrees, relationLabel } from "./kg-net-rules";
import type { Graph, Node } from "./graph";
import { nodeHealth } from "./studio-model";
import { recordYmd, timeTree } from "@/features/explore/components/network/time-tree";
import type { NetEdge, NetNode, NetPrebuiltInput } from "@/features/explore/components/network/types";
import type { ExploreTone } from "@/features/explore/model";

/**
 * 지식그래프 → 연결 탐색 네트워크 판(원장 2026-11-11 *"스키마 지식그래프에서도 연결탐색처럼 동작할 수 있게"*) — 순수 함수
 * (`"use client"`/`server-only` 금지 — [[#61]]·[[#81]]). 판 기계(배치·그리기·보간·묶음)는 연결 탐색의 것을 그대로 쓰고, 여기서는 점·선만 짠다.
 *
 * 규칙:
 *  · 가운데 = 고른 기록(주소 `?student=`·`?teacher=` 또는 판에서 더블클릭한 기록). 없거나 학원(Academy) 점이면 **학원 전체**(`<지점>:academy`).
 *    출처마다 따로 실어 온 학원 점(`…:source:student:academy:…`)은 판에 세우지 않는다 — 학원 점과의 소속 관계는 어느 판에서도 긋지 않는다(영역 선이 소속을 말한다).
 *  · 판에 서는 기록: 학원 전체 = 학원 점을 뺀 모든 기록. 기록이 가운데 = 가운데 + 바로 이어진 기록(1단계) + 그 기록들에 이어진 기록 중
 *    **가운데와 유형이 다른 것**(2단계) — 강사의 원생·원생의 강사는 서고, 같은 반 친구·같이 가르치는 강사는 번지지 않는다.
 *    학원 점은 이 이웃 계산에 넣지 않는다(학원은 모든 기록과 이어져 두 단계가 곧 전부가 된다).
 *  · 영역(큰 점) = 주체 유형(`catalog.ts` `entities` 순서 · 이름 = 그 한글 이름) · 색 = 연결 탐색 영역 색(`ExploreTone`) 하나씩.
 *  · 날짜 = `attributes.date`(날짜 또는 시각 — `recordYmd`, KST)뿐. 🔴 `node.period`는 날짜로 쓰지 않는다(학교 점은 거기에 기준일을 싣는다) ·
 *    날짜를 지어내지 않는다. 날짜 있는 기록은 영역 아래 연도 → 월 → (같은 날 여럿이면) 일자 묶음(`timeTree`), 없는 기록은 영역 둘레.
 *  · 선 = 판 뼈대(가운데 → 영역 → 묶음 → 기록) + 판에 선 두 기록 사이의 **실제 관계**(같은 두 기록이면 한 선 · 이름은 관계 이름을 모아서).
 *    데이터에 없는 관계는 긋지 않는다.
 * 점 id = 지식그래프 점 id 그대로(가운데도) — 더블클릭한 기록 점이 그대로 새 가운데가 되어 보간이 이어진다. 영역 `hub:<유형>` · 묶음 `grp:<유형>:<기간>`.
 */

export { isolatedCount, kgDetailParam, relationLabel } from "./kg-net-rules";

export const ACADEMY_TITLE = "학원 전체";
export const academyNodeId = (tenant: string) => `${tenant}:academy`;

/** 영역 색 — 연결 탐색의 영역 색 값만(새 색 없음). 7색이라 흔히 함께 서는 유형(학생·반·강사·학교·학습·상담·관찰)부터 겹치지 않게. */
const TONE: Record<Entity, ExploreTone> = {
  Academy: "primary", Student: "blue", Parent: "blue", Staff: "green", Course: "purple", Enrollment: "purple", School: "amber",
  Consultation: "rose", LearningRecord: "gold", Commitment: "rose", CareTask: "rose", DropoutFactor: "rose", Event: "amber",
  Campaign: "amber", Channel: "amber", Touchpoint: "amber", Content: "amber", Invoice: "gold", Finance: "gold", Facility: "purple",
  Competitor: "amber", Observation: "primary", Action: "green", Objective: "green", Assessment: "purple", Metric: "gold", Evidence: "primary",
};

/**
 * 날짜 없는 기록을 영역 둘레에 바로 세우는 수 — 관계가 많은 순으로 이만큼만 세우고, 나머지는 '외 N건' 묶음 · 관계 없는 기록은 '관계 없음 N건'
 * 묶음으로 접는다(원장 2026-11-11 *"너무 쓸데없이 모든 점을 노출하지 않는지"* — 연결 탐색이 날짜 기록을 연도·월로 접는 것과 같은 방향).
 * 묶음 더블클릭 = 펼치기(그 아래 기록 전부) · 목록·관계 표에서 고르면 그 묶음이 펼쳐진다. 기록은 빠지지 않는다(도구줄 수 = 전부).
 */
export const KG_UNDATED_SHOWN = 12;

export type KgBoard = NetPrebuiltInput & {
  /** 학원 전체 판인가(아니면 기록이 가운데인 판). */
  academy: boolean;
  /** 판에 선 기록 수(가운데 제외) · 조회된 전체 기록 수(학원 점 제외 — 학원 전체 판의 '판에 선 기록'과 같은 수). */
  shown: number;
  total: number;
};

const firstLine = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const line = v.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
  return line ? (line.length > 60 ? `${line.slice(0, 60)}…` : line) : null;
};
const dateOf = (n: Node): string | null => {
  const raw = n.attributes?.date;
  return typeof raw === "string" && recordYmd(raw) ? raw : null;
};

/** 지식그래프 + 가운데(점 id · 없으면 학원 전체) → 네트워크 판. */
export function kgNetBoard(graph: Graph, centerId?: string | null): KgBoard {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const isAcademy = (id: string) => byId.get(id)?.type === "Academy";
  const pick = centerId ? byId.get(centerId) : undefined;
  const focus = pick && pick.type !== "Academy" ? pick : null;
  const rootId = focus ? focus.id : academyNodeId(graph.tenant);
  const total = graph.nodes.filter((n) => n.type !== "Academy").length;

  let members: Node[];
  if (!focus) members = graph.nodes.filter((n) => n.type !== "Academy");
  else {
    const adj = new Map<string, Set<string>>();
    const tie = (a: string, b: string) => adj.set(a, (adj.get(a) ?? new Set()).add(b));
    for (const e of graph.edges)
      if (e.from !== e.to && byId.has(e.from) && byId.has(e.to) && !isAcademy(e.from) && !isAcademy(e.to)) {
        tie(e.from, e.to);
        tie(e.to, e.from);
      }
    const one = adj.get(focus.id) ?? new Set<string>();
    const keep = new Set([focus.id, ...one]);
    // 2단계는 중심과 유형이 다른 1단계 점에서만 넓힌다(형제·같은 반 학생을 거쳐 그 사람의 기록까지 번지지 않게).
    for (const a of one) if (byId.get(a)!.type !== focus.type) for (const b of adj.get(a) ?? []) if (byId.get(b)!.type !== focus.type) keep.add(b);
    members = graph.nodes.filter((n) => keep.has(n.id));
  }

  const nodes: NetNode[] = [{ id: rootId, title: focus ? focus.label : ACADEMY_TITLE, kind: "root", tone: "primary" }];
  const groups: NetNode[] = [];
  const edges: NetEdge[] = [];
  const linked = new Set<string>();
  const link = (a: string, b: string, rel: string) => {
    if (a === b || linked.has(`${a}|${b}`) || linked.has(`${b}|${a}`)) return;
    linked.add(`${a}|${b}`);
    edges.push({ from: a, to: b, rel });
  };
  const degree = degrees(graph);
  const related = new Set(degree.keys());
  const byType = new Map<Entity, Node[]>();
  for (const n of members) {
    if (n.id === rootId) continue;
    const list = byType.get(n.type);
    if (list) list.push(n);
    else byType.set(n.type, [n]);
  }
  for (const [type, label] of entities) {
    const list = byType.get(type);
    if (!list?.length) continue;
    const hubId = `hub:${type}`;
    const lonely = list.filter((n) => !related.has(n.id)).length;
    const hub: NetNode = { id: hubId, title: label, kind: "hub", tone: TONE[type], sectorKey: type, zoomKey: type, summary: [`기록 ${list.length.toLocaleString()}건`, lonely > 0 && `다른 기록과 관계 없음 ${lonely.toLocaleString()}건`].filter(Boolean).join(" · ") };
    nodes.push(hub);
    link(rootId, hubId, label);
    const dated: NetNode[] = [];
    const loose: NetNode[] = [];
    for (const n of list) {
      const date = dateOf(n);
      const detail = [nodeHealth(n), firstLine(n.attributes?.detail) ?? firstLine(n.detail)].filter(Boolean).join(" · ") || null;
      const rec: NetNode = { id: n.id, title: n.label, kind: "record", tone: TONE[type], hub: hubId, sectorKey: type, rowId: n.id, date, detail, open: "center" };
      nodes.push(rec);
      if (date) dated.push(rec);
      else loose.push(rec);
    }
    // 날짜 없는 기록 — 관계 많은 순 앞 몇 건만 영역 둘레에, 나머지는 접힌 묶음(한 건뿐이면 묶지 않는다).
    const fold = (gid: string, title: string, short: string, recs: NetNode[]) => {
      if (recs.length < 2) return recs.forEach((r) => link(hubId, r.id, label));
      const g: NetNode = { id: `grp:${type}:${gid}`, title, label: `${short} · ${recs.length.toLocaleString()}건`, kind: "group", level: "month", tone: TONE[type], hub: hubId, parent: hubId, sectorKey: type, date: null, tally: recs.length };
      groups.push(g);
      link(hubId, g.id, "묶음");
      for (const r of recs) {
        r.parent = g.id;
        link(g.id, r.id, "기록");
      }
    };
    const withRel = loose.filter((r) => related.has(r.id)).sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0));
    const rest = withRel.length > KG_UNDATED_SHOWN + 1 ? withRel.slice(KG_UNDATED_SHOWN) : [];
    for (const r of withRel.slice(0, withRel.length - rest.length)) link(hubId, r.id, label);
    fold("more", `${label} 외 ${rest.length.toLocaleString()}건`, "외", rest);
    const none = loose.filter((r) => !related.has(r.id));
    fold("none", `${label} · 다른 기록과 관계 없음`, "관계 없음", none);
    if (dated.length > 0) {
      const t = timeTree(hub, dated);
      groups.push(...t.groups);
      for (const e of t.edges) link(e.from, e.to, e.rel);
    }
  }
  nodes.push(...groups);

  // 실제 관계 — 판에 선 두 기록 사이만(학원 점과의 관계는 긋지 않는다). 같은 두 기록은 한 선 · 이름은 모아서.
  const onBoard = new Set(nodes.filter((n) => n.kind === "record" || n.kind === "root").map((n) => n.id));
  // 학원 점과의 소속 관계는 긋지 않는다(학원 전체 판은 가운데 → 영역 선이 이미 소속을 말하고, 기록이 가운데인 판엔 학원 점이 없다).
  const end = (id: string) => (isAcademy(id) ? null : onBoard.has(id) ? id : null);
  const pairs = new Map<string, { from: string; to: string; rels: Set<string> }>();
  for (const e of graph.edges) {
    const a = end(e.from);
    const b = end(e.to);
    if (!a || !b || a === b) continue;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    const p = pairs.get(key) ?? { from: a, to: b, rels: new Set<string>() };
    p.rels.add(relationLabel(e));
    pairs.set(key, p);
  }
  for (const p of pairs.values()) link(p.from, p.to, [...p.rels].join(" · "));

  return { graph: { nodes, edges }, center: { id: rootId, name: focus ? focus.label : ACADEMY_TITLE }, academy: !focus, shown: nodes.filter((n) => n.kind === "record").length, total };
}
