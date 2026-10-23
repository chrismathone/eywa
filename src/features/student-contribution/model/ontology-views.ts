import type { StudentFact } from "@/features/students/ontology/types";
import { summarizeOntologyView, type ExplorerKind } from "@/features/students/ontology/explorer";
import { latestStudentSourceFacts, visibleStudentFacts } from "@/features/students/ontology/visible-facts";
import { canReadFactSource } from "@/features/students/ontology/read-policy";

export type OntologySnapshot = { student_id: string; computed_at: string; facts: StudentFact[] | null };
/** 전체 원본 대신 관점별 작은 요약만 캐시·전송한다. 담당 범위가 달라지면 다른 결과다. */
export function projectOntologyViews(tenant: string, rows: OntologySnapshot[], eligible: ReadonlySet<string>,
  canonical: (id: string) => string, readable: ReadonlySet<string> | null) {
  const latest = latestStudentSourceFacts(tenant, rows.map((r) => ({ computedAt: r.computed_at, facts: r.facts ?? [] })));
  const facts = visibleStudentFacts(tenant, [{ computedAt: "", facts: latest.filter((f) => eligible.has(canonical(f.studentId)) && canReadFactSource(f, readable)) }], canonical);
  const grouped = new Map<string, StudentFact[]>();
  for (const fact of facts) {
    const scopes = new Set([`academy:${tenant}`, `student:${fact.studentId}`, ...fact.related.map((r) => `${r.kind}:${r.id}`)]);
    for (const scope of scopes) { const group = grouped.get(scope) ?? []; group.push(fact); grouped.set(scope, group); }
  }
  return Object.fromEntries([...grouped].map(([key, group]) => {
    const colon = key.indexOf(":"), kind = key.slice(0, colon) as ExplorerKind;
    return [key, summarizeOntologyView(tenant, group, { kind, id: key.slice(colon + 1) })];
  }));
}
