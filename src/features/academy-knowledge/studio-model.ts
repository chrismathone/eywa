import { z } from "zod";
import { blueprint } from "./blueprint";
import { entities, type Entity } from "./catalog";
import type { Graph, Node } from "./graph";

const text = z.string().trim().min(1).max(160);
const entity = z.enum(entities.map(e => e[0]) as [Entity, ...Entity[]]);
export const studioDocument = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("field"), sheet: text, field: text, label: text, required: z.boolean(), note: z.string().trim().max(1200) }).strict(),
  z.object({ kind: z.literal("expectation"), label: text, subject: entity, target: entity, minimum: z.number().int().min(1).max(100), active: z.boolean() }).strict(),
  z.object({ kind: z.literal("link"), from: text.max(500), to: text.max(500), label: text, basis: z.string().trim().min(5).max(1500), date: z.iso.date(), state: z.enum(["pending", "confirmed", "retired"]) }).strict(),
]);
export type StudioDocument = z.infer<typeof studioDocument>;
export const studioRequest = z.object({ key: z.string().min(1).max(240), expectedVersion: z.number().int().min(0), document: studioDocument,
  context: z.object({ month: z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/), student: z.uuid().optional(), teacher: z.uuid().optional() }).strict(),
}).strict();
export type StudioRow = { key: string; version: number; document: StudioDocument; actor_id: string; recorded_at: string };
export type Expectation = Extract<StudioDocument, { kind: "expectation" }> & { key: string; version: number };
export const defaultExpectations: Expectation[] = [
  ["student-course", "수강 연결", "Student", "Course"], ["student-school", "학교·학년", "Student", "School"],
  ["student-learning", "학습 기록", "Student", "LearningRecord"], ["student-consultation", "상담 기록", "Student", "Consultation"],
  ["student-commitment", "입학 약속", "Student", "Commitment"], ["student-care", "정착 관리", "Student", "CareTask"],
  ["student-assessment", "분석 근거", "Student", "Assessment"], ["staff-course", "담당 강좌", "Staff", "Course"],
  ["staff-observation", "관찰·피드백", "Staff", "Observation"], ["campaign-channel", "홍보 채널", "Campaign", "Channel"],
  ["campaign-touch", "유입·참석 접점", "Campaign", "Touchpoint"], ["objective-metric", "핵심 결과", "Objective", "Metric"],
  ["action-owner", "후속 담당자", "Action", "Staff"],
].map(([key,label,subject,target]) => ({ kind: "expectation", key: `expectation:${key}`, label, subject: subject as Entity, target: target as Entity, minimum: 1, active: true, version: 0 }));

export function latestStudio(history: StudioRow[]) {
  const rows = new Map<string, StudioRow>();
  for (const r of history) if (!rows.has(r.key) || rows.get(r.key)!.version < r.version) rows.set(r.key, r);
  return [...rows.values()];
}
export function expectations(rows: StudioRow[]): Expectation[] {
  const merged = new Map(defaultExpectations.map(r => [r.key, r]));
  for (const r of latestStudio(rows)) if (r.document.kind === "expectation") merged.set(r.key, { ...r.document, key: r.key, version: r.version });
  return [...merged.values()];
}
export function validateStudioKey(key: string, doc: StudioDocument) {
  if (doc.kind === "field") {
    const sheet = blueprint.find(s => s.id === doc.sheet);
    if (!sheet?.fields.some(f => f.id === doc.field) || key !== `field:${doc.sheet}:${doc.field}`) throw Error("엑셀 항목을 다시 확인해 주세요");
  } else if (doc.kind === "expectation") {
    if (!/^expectation:[a-z0-9-]{1,80}$/.test(key)) throw Error("점검 기준을 확인해 주세요");
  } else if (!/^link:[a-f0-9-]{36}$/.test(key) || doc.from === doc.to) throw Error("서로 다른 두 기록을 선택해 주세요");
}

/** Pair strength counts unique typed relationships, not repeated reads or duplicated source rows. */
export function uniqueEdges(graph: Graph) {
  const found = new Map<string, Graph["edges"][number]>();
  for (const e of graph.edges) found.set(JSON.stringify([e.from, e.to, e.relation, e.sourceRelation]), e);
  return [...found.values()];
}
export function edgeAppearance(count: number) {
  const strength = Math.min(1, Math.log2(Math.max(1, count)) / 8);
  return { width: 1 + 5 * strength, opacity: .28 + .68 * strength };
}
export function applyStudioLinks(graph: Graph, rows: StudioRow[], through: string): Graph {
  const ids = new Set(graph.nodes.map(n => n.id));
  const edges = latestStudio(rows).flatMap(r => {
    const d = r.document;
    if (d.kind !== "link" || d.state !== "confirmed" || d.date > through || !ids.has(d.from) || !ids.has(d.to)) return [];
    return [{ from: d.from, to: d.to, relation: "RELATED_RECORD", sourceRelation: `manual-reference:${r.key}`, basis: `${d.label} · ${d.basis} · 직접 확인 v${r.version}`, evidence: [], asOf: r.recorded_at, period: { from: d.date, through: null } }];
  });
  return { ...graph, edges: [...graph.edges, ...edges] };
}
export type Gap = { key: string; label: string; subject: string; target: Entity; actual: number; minimum: number; state: "connected" | "missing" | "unloaded"; href: string };
export function nodeHealth(node:Node) {
  const state=node.state??String(node.attributes?.state??"");
  if(["missing","insufficient","unavailable","failed","error","forbidden","off"].includes(state))return "자료 부족";
  if(state==="partial")return "부분 자료";
  if(["pending","submitted","review"].includes(state))return "확인 대기";
  return "";
}
const destinations: Partial<Record<Entity,string>> = { Course: "/classes", Staff: "/staff", School: "/students", LearningRecord: "/work-records", Consultation: "/consultations", Commitment: "/newcomers", CareTask: "/newcomers", Assessment: "/student-contribution", Channel: "/marketing", Touchpoint: "/marketing", Metric: "/organization/okr", Observation: "/work-records/knowledge" };
export function nodeGaps(graph: Graph, node: Node, rules: Expectation[], detailedStudent: string, detailedTeacher: string): Gap[] {
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  // A human reference never stands in for a missing enrollment, call, invoice, or completed task.
  const adjacent = uniqueEdges(graph).filter(e => !e.sourceRelation.startsWith("manual-reference:") && (e.from === node.id || e.to === node.id));
  const neighbors = new Set(adjacent.map(e=>e.from===node.id?e.to:e.from));
  const bridges = new Set([...neighbors].filter(id=>["Observation","Enrollment"].includes(byId.get(id)?.type??"")));
  for(const e of uniqueEdges(graph)) if(!e.sourceRelation.startsWith("manual-reference:")) {
    if(bridges.has(e.from))neighbors.add(e.to);
    if(bridges.has(e.to))neighbors.add(e.from);
  }
  return rules.filter(r => r.active && r.subject === node.type).map(r => {
    const actual = [...neighbors].filter(id=>{const n=byId.get(id);return id!==node.id&&n?.type===r.target&&!nodeHealth(n)&&!["factor","axis"].includes(String(n.attributes?.recordKind??""));}).length;
    const unloaded = node.type === "Student" && !["Course", "School", "Invoice"].includes(r.target) && node.id !== `${graph.tenant}:student:${detailedStudent}` || node.type === "Staff" && r.target !== "Course" && node.id !== `${graph.tenant}:staff:${detailedTeacher}`;
    return { key: r.key, label: r.label, subject: node.id, target: r.target, actual, minimum: r.minimum, state: actual >= r.minimum ? "connected" : unloaded ? "unloaded" : "missing", href: destinations[r.target] ?? "/work-records/knowledge" };
  });
}
