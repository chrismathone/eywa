import type { LiveSection } from "@/features/students/ontology/live-contract";
import type { StudentFact } from "@/features/students/ontology/types";
import type { careGraph } from "@/features/student-care/graph";

export type HubAnalysis = {
  id: string; title: string; body: string; basis: "rule" | "ai";
  generatedAt: string | null; href: string; evidence: string[];
  state: "ready" | "partial" | "historical"; period?: string;
};
export type HubCoverage = { key: string; label: string; state: string; note: string };
export type HubNode = {
  id: string; kind: string; label: string; source?: string; href?: string;
  attributes?: Record<string, unknown>;
};
export type HubEdge = { from: string; to: string; relation: string; basis: "recorded" | "rule" | "ai"; asOf?: string; period?: { from: string; through: string | null } | null; evidence?: string[] };
export type CareGraph = ReturnType<typeof careGraph>;
const aliases: Record<string, string> = { lesson_report: "lesson_reports", consultation: "student_consultations", enrollment_consultation: "enrollment_consultations", staff: "teacher" };
export const hubNodeId = (tenant: string, kind: string, id: string) => `${tenant}:${aliases[kind] ?? kind}:${id}`;

/** Inputs must already pass their source permissions. Names never identify or merge a student. */
export function studentHubGraph(input: {
  tenant: string; studentId: string; name: string; checkedAt: string; month: string;
  profile?: Record<string, unknown>;
  sections: LiveSection[]; facts: StudentFact[]; care: CareGraph | null;
  analyses: HubAnalysis[]; coverage: HubCoverage[];
}) {
  const root = hubNodeId(input.tenant, "student", input.studentId);
  const nodes = new Map<string, HubNode>([[root, { id: root, kind: "student", label: input.name, href: `/students/${input.studentId}`, source: "students", attributes: input.profile }]]);
  const edges = new Map<string, HubEdge>();
  const addNode = (node: HubNode) => nodes.set(node.id, { ...nodes.get(node.id), ...node });
  const addEdge = (edge: HubEdge) => edges.set(JSON.stringify([edge.from, edge.relation, edge.to, edge.basis, edge.asOf, edge.period]), edge);
  for (const section of input.sections) {
    if (section.state !== "ready" && section.state !== "partial") continue;
    for (const item of section.items) {
      // One enrollment can produce both a start and an end event; keep both observations.
      const observation = hubNodeId(input.tenant, "observation", `${section.key}:${item.id}`);
      addNode({ id: observation, kind: "observation", label: item.title, href: item.evidence[0]?.href,
        attributes: { date: item.date ?? null, detail: item.detail, section: section.key } });
      addEdge({ from: root, to: observation, relation: section.key, basis: "recorded", asOf: input.checkedAt });
      for (const evidence of item.evidence) {
        const id = hubNodeId(input.tenant, evidence.source, evidence.id);
        addNode({ id, kind: "record", label: item.title, source: evidence.source, href: evidence.href,
          attributes: { date: item.date ?? null, detail: item.detail, originalStudentId: evidence.studentId } });
        addEdge({ from: observation, to: id, relation: "supportedBy", basis: "recorded" });
      }
      for (const relation of item.relations ?? []) {
        if (relation.tenantId !== input.tenant) continue;
        const from = hubNodeId(input.tenant, relation.from.kind, relation.from.id), to = hubNodeId(input.tenant, relation.to.kind, relation.to.id);
        if (!nodes.has(from)) addNode({ id: from, kind: relation.from.kind, label: relation.from.kind });
        if (!nodes.has(to)) addNode({ id: to, kind: relation.to.kind, label: relation.to.kind });
        for (const e of relation.evidence) {
          const recordId = hubNodeId(input.tenant, e.source, e.id);
          if (!nodes.has(recordId)) addNode({ id: recordId, kind: "record", label: e.source, source: e.source, href: e.href, attributes: { originalStudentId: e.studentId } });
        }
        addEdge({ from, to, relation: relation.kind, basis: "recorded", asOf: relation.asOf, period: relation.period,
          evidence: relation.evidence.map((e) => hubNodeId(input.tenant, e.source, e.id)) });
      }
    }
  }
  for (const fact of input.facts) {
    if (fact.tenantId !== input.tenant || fact.studentId !== input.studentId) continue;
    const id = hubNodeId(input.tenant, "fact", fact.id);
    const evidence = fact.evidence.map((e) => hubNodeId(input.tenant, e.source, e.id));
    addNode({ id, kind: "fact", label: fact.kind, attributes: { value: fact.value, occurred: fact.occurred, recordedAt: fact.recordedAt, state: fact.state, ruleVersion: fact.ruleVersion } });
    addEdge({ from: root, to: id, relation: fact.kind, basis: fact.basis, evidence });
    fact.evidence.forEach((e, index) => {
      if (!nodes.has(evidence[index])) addNode({ id: evidence[index], kind: "record", label: e.source, source: e.source, attributes: { originalStudentId: e.studentId } });
      addEdge({ from: id, to: evidence[index], relation: "supportedBy", basis: fact.basis });
    });
    for (const ref of fact.related) {
      const related = hubNodeId(input.tenant, ref.kind, ref.id);
      if (!nodes.has(related)) addNode({ id: related, kind: ref.kind, label: ref.kind });
      addEdge({ from: id, to: related, relation: "relatedTo", basis: fact.basis, asOf: fact.occurred.value, evidence });
    }
  }
  // Care has its own vocabulary; normalize IDs so evidence and the student are shared nodes.
  const careIds = new Map<string, string>();
  for (const node of input.care?.nodes ?? []) {
    if (!node.id.startsWith(`${input.tenant}:`)) continue;
    const id = hubNodeId(input.tenant, node.kind, node.sourceId);
    careIds.set(node.id, id);
    if (id === root) continue;
    addNode({ id, kind: nodes.get(id)?.kind ?? node.kind, label: nodes.get(id)?.label ?? String(node.attributes?.promise ?? node.kind), attributes: { ...nodes.get(id)?.attributes, ...node.attributes },
      ...(node.kind === "commitment" ? { href: `/students/${input.studentId}/care` } : {}) });
  }
  for (const edge of input.care?.edges ?? []) {
    const from = careIds.get(edge.from), to = careIds.get(edge.to);
    if (from && to) addEdge({ from, to, relation: edge.kind, basis: "recorded" });
  }
  for (const analysis of input.analyses) {
    const id = hubNodeId(input.tenant, "analysis", `${input.studentId}:${analysis.id}`);
    const evidence = analysis.evidence.filter((e) => nodes.has(e));
    addNode({ id, kind: "analysis", label: analysis.title, href: analysis.href, attributes: { ...analysis } });
    addEdge({ from: root, to: id, relation: "hasAnalysis", basis: analysis.basis, evidence });
    for (const source of evidence) addEdge({ from: id, to: source, relation: "supportedBy", basis: analysis.basis });
  }
  return { schema: "aywa-student-hub-v1", studentId: input.studentId, root, checkedAt: input.checkedAt,
    scope: { month: input.month, mode: "source_previews_and_month_facts", allHistoryLoaded: false },
    coverage: input.coverage, nodes: [...nodes.values()], edges: [...edges.values()] };
}
