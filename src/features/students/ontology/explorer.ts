import { aggregateStudentOntology } from "./aggregate";
import type { EntityRef, StudentFact } from "./types";

export const EXPLORER_KINDS = ["student", "class", "teacher", "subject", "academy"] as const;
export type ExplorerKind = typeof EXPLORER_KINDS[number];
export type ExplorerLink = { kind: ExplorerKind; id: string; factCount: number };

/** 같은 원본 사실에서 확인된 연결만 투영한다. 학생 집합 교집합으로 담당 관계를 추론하지 않는다. */
export function summarizeOntologyView(tenant: string, input: readonly StudentFact[], scope: EntityRef) {
  const result = aggregateStudentOntology(tenant, input, scope);
  const links = new Map<string, ExplorerLink>();
  const studentCounts: Record<string, Partial<Record<StudentFact["kind"], number>>> = {};
  const basis = { recorded: 0, rule: 0, ai: 0 };
  let recordedAt = "";
  for (const fact of result.facts) {
    basis[fact.basis]++;
    if (fact.recordedAt > recordedAt) recordedAt = fact.recordedAt;
    const counts = studentCounts[fact.studentId] ??= {};
    counts[fact.kind] = (counts[fact.kind] ?? 0) + 1;
    const refs: EntityRef[] = [{ kind: "student", id: fact.studentId }, { kind: "academy", id: tenant }, ...fact.related];
    const seen = new Set<string>();
    for (const ref of refs) {
      if (!EXPLORER_KINDS.some((kind) => kind === ref.kind) || (ref.kind === scope.kind && ref.id === scope.id)) continue;
      const key = `${ref.kind}:${ref.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const link = links.get(key) ?? { kind: ref.kind as ExplorerKind, id: ref.id, factCount: 0 };
      link.factCount++;
      links.set(key, link);
    }
  }
  return { students: result.students, counts: result.counts, factCount: result.facts.length,
    tuitionWon: result.tuitionWon, unallocatedTuitionFacts: result.unallocatedTuitionFacts,
    parentEvents: result.parentEvents,
    related: [...links.values()], studentCounts, basis, recordedAt };
}
