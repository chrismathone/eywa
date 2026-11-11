import { entities, type Entity } from "./catalog";
import { degrees, relationLabel } from "./kg-net-rules";
import { categoryTree, kgCategorized, studentStatusBuckets, type KgCategoryAt, type KgCategoryCtx } from "./kg-net-groups";
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
 *  · 날짜 = `attributes.date`(날짜 또는 시각 — `recordYmd`, KST)뿐. `attributes.date`가 없으면 사건 유형(`PERIOD_IS_EVENT_DATE`)의 단일 날짜 `period`만 · 🔴 학교·평가·근거의 `period`는 날짜로 쓰지 않는다(기준일·범위·스냅숏) ·
 *    날짜를 지어내지 않는다. 날짜 있는 기록은 영역 아래 연도 → 월 → (같은 날 여럿이면) 일자 묶음(`timeTree`), 없는 기록은 영역 둘레.
 *  · 선 = 판 뼈대(가운데 → 영역 → 묶음 → 기록) + 판에 선 두 기록 사이의 **실제 관계**(같은 두 기록이면 한 선 · 이름은 관계 이름을 모아서 · 그 점을 강조할 때만 그린다).
 *    데이터에 없는 관계는 긋지 않는다.
 * 점 id = 지식그래프 점 id 그대로(가운데도) — 더블클릭한 기록 점이 그대로 새 가운데가 되어 보간이 이어진다. 영역 `hub:<유형>` · 날짜 묶음 `grp:<유형>:<기간>` · 분류 묶음 `grp:<유형>:cat:<단계…>`(`kg-net-groups.ts`) · `grp:<유형>:status:<상태>`·`none`.
 */

export { isolatedCount, kgDetailParam, relationLabel } from "./kg-net-rules";
export type { KgCategoryCtx } from "./kg-net-groups";

export const ACADEMY_TITLE = "학원 전체";
export const academyNodeId = (tenant: string) => `${tenant}:academy`;

/** 영역 색 — 연결 탐색의 영역 색 값만(새 색 없음). 7색이라 흔히 함께 서는 유형(학생·반·강사·학교·학습·상담·관찰)부터 겹치지 않게. */
const TONE: Record<Entity, ExploreTone> = {
  Academy: "primary", Student: "blue", Parent: "blue", Staff: "green", Course: "purple", Enrollment: "purple", School: "amber",
  Consultation: "rose", LearningRecord: "gold", Commitment: "rose", CareTask: "rose", DropoutFactor: "rose", Event: "amber",
  Campaign: "amber", Channel: "amber", Touchpoint: "amber", Content: "amber", Invoice: "gold", Finance: "gold", Facility: "purple",
  Competitor: "amber", Observation: "primary", Action: "green", Objective: "green", Assessment: "purple", Metric: "gold", Evidence: "primary",
};

/*
 * 날짜 없는 기록 — 학교·원생·직원·반은 분류 묶음(초·중·고 → 학년 / 과목 · 기타 — `kg-net-groups.ts`) · 선이 없는 원생은 지금 상태 묶음(휴원·예비·퇴원) 안에서 같은 분류 ·
 * 선이 하나도 없는 기록은 '관계 없음'(직원 = '반·기록 연결 없음') 묶음 안에서 같은 분류 · 그 밖의 유형은 영역 둘레에 바로.
 * 개별 기록 판은 묶음을 모두 펼친다(원장 2026-11-11 *"개별기록에서는 가지를 극한으로 계속 뻗어 마지막 요소가 나올때까지"* — 옛 '앞 12건 + 나머지 N건' 접기 폐지 ·
 * 덩어리로 줄여 보는 것은 '주체별 요약'). 묶음 더블클릭 = 접기·펼치기. 기록은 빠지지 않는다(도구줄 수 = 전부).
 */

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
/** `period`에 그 기록이 일어난 날을 싣는 사건 유형 — 강사 통합 기록·OKR은 날짜를 여기에만 싣는다(2026-11-11 원장 승인).
 *  🔴 학교(기준일)·평가(기간 범위)·근거(스냅숏 시각)는 넣지 않는다 — 사건 날짜가 아니다. */
const PERIOD_IS_EVENT_DATE = new Set<Node["type"]>(["Consultation", "LearningRecord", "Observation", "Action", "Objective", "Invoice", "Enrollment"]);
const SINGLE_DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.+\-Z]*)?$/;
const dateOf = (n: Node): string | null => {
  const raw = n.attributes?.date;
  if (typeof raw === "string" && recordYmd(raw)) return raw;
  if (n.attributes && "date" in n.attributes) return null; // 원본이 날짜 칸을 두고 비워 둔 것 = 모름(period로 메우지 않는다)
  const p = n.period;
  if (n.id.includes(":okr_task:")) return null; // OKR 할 일의 period = 마감 예정일(계획) — 일어난 날이 아니다(미래 달에 꽂힌다)
  return PERIOD_IS_EVENT_DATE.has(n.type) && typeof p === "string" && SINGLE_DATE.test(p) && recordYmd(p) ? p : null;
};

/** 지식그래프 + 가운데(점 id · 없으면 학원 전체) → 네트워크 판. */
export function kgNetBoard(graph: Graph, centerId?: string | null, cats?: KgCategoryCtx): KgBoard {
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
  const link = (a: string, b: string, rel: string, focusOnly?: boolean) => {
    if (a === b || linked.has(`${a}|${b}`) || linked.has(`${b}|${a}`)) return;
    linked.add(`${a}|${b}`);
    edges.push(focusOnly ? { from: a, to: b, rel, focusOnly } : { from: a, to: b, rel });
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
    const hub: NetNode = { id: hubId, title: label, kind: "hub", tone: TONE[type], sectorKey: type, zoomKey: type, summary: `기록 ${list.length.toLocaleString()}건` }; // 묶음 수는 아래에서 덧붙인다(묶음 이름과 같은 말로)
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
    // 날짜 없는 기록 — 위 주석 그대로. 묶음 하나 = `grp:<유형>:<gid>`(상태 `status:<상태>` · 관계 없음 `none`) · 안은 분류(있으면) 또는 기록.
    const byCategory = !!cats && kgCategorized(type);
    const tree = (recs: NetNode[], at: KgCategoryAt) => {
      const t = categoryTree(hub, type, recs, byId, cats!, at);
      groups.push(...t.groups);
      for (const e of t.edges) link(e.from, e.to, e.rel);
    };
    const bucket = (gid: string, short: string, recs: NetNode[], always: boolean, note = "") => {
      if (recs.length > 0) hub.summary += ` · ${short} ${recs.length.toLocaleString()}건`;
      if (recs.length === 0 || (!always && recs.length < 2)) return recs.forEach((r) => link(hubId, r.id, label));
      const title = `${label} · ${short}${note}`;
      const g: NetNode = { id: `grp:${type}:${gid}`, title, label: `${short} · ${recs.length.toLocaleString()}건`, kind: "group", level: "month", tone: TONE[type], hub: hubId, parent: hubId, sectorKey: type, date: null, tally: recs.length };
      groups.push(g);
      link(hubId, g.id, "묶음");
      if (byCategory) return tree(recs, { parent: g.id, prefix: `${gid}/`, title });
      for (const r of recs) {
        r.parent = g.id;
        link(g.id, r.id, "기록");
      }
    };
    const withRel = loose.filter((r) => related.has(r.id));
    if (byCategory && withRel.length > 1) tree(withRel, { parent: hubId, prefix: "", title: label });
    else for (const r of withRel) link(hubId, r.id, label);
    // 선이 하나도 없는 기록만 — 원생은 지금 상태로(휴원·예비·퇴원 · 지난 달 판에서도 그 달 연결이 있으면 본 분류에 선다), 나머지는 '관계 없음'(직원 = '반·기록 연결 없음').
    const lone = loose.filter((r) => !related.has(r.id));
    const { rest: none, buckets } = type === "Student" && byCategory ? studentStatusBuckets(lone, byId) : { rest: lone, buckets: [] };
    for (const b of buckets) bucket(`status:${b.key}`, b.label, b.recs, true, " — 지금 상태 · 이 판에 연결 없음");
    bucket("none", type === "Staff" ? "반·기록 연결 없음" : "관계 없음", none, false);
    if (dated.length > 0) {
      const t = timeTree(hub, dated);
      groups.push(...t.groups);
      for (const e of t.edges) link(e.from, e.to, e.rel);
    }
  }
  for (const g of groups) g.expanded = true; // 개별 기록 = 가지를 끝까지(날짜 묶음 포함 · 더블클릭으로 접는다)
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
  // 🔴 기록 사이 관계선은 그 점을 강조할 때만(마우스를 올리거나 고른 점 — `focusOnly`) — 늘 그리면 학원 전체 판에 1,000개가 넘어 정신없고 렉이 난다(원장 2026-11-11).
  //    처음 판은 뼈대(가운데 → 영역 → 묶음 → 기록) + **가운데 기록의 직접 관계선**(기록이 가운데인 판에서 1단계·2단계를 가르는 선 — 가운데는 고른 점이 될 수 없어 늘 그린다).
  //    이웃 강조·요약 판 집계는 그대로 이 선을 쓴다.
  for (const p of pairs.values()) link(p.from, p.to, [...p.rels].join(" · "), p.from !== rootId && p.to !== rootId);

  return { graph: { nodes, edges }, center: { id: rootId, name: focus ? focus.label : ACADEMY_TITLE }, academy: !focus, shown: nodes.filter((n) => n.kind === "record").length, total };
}
