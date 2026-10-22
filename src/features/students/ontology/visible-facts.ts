import type { StudentFact } from "./types";
/** 마감 원본을 이동하지 않고 병합을 조회 때 해석한다. 같은 사실의 여러 저장본은 가장 최근 확인본 하나를 사용한다. */
export function visibleStudentFacts(tenant: string, rows: readonly { computedAt: string; facts: readonly StudentFact[] }[], canonical: (id: string) => string) {
  const latest = new Map<string, { at: string; fact: StudentFact }>();
  for (const row of rows) for (const fact of row.facts) {
    if (fact.tenantId !== tenant) throw new Error("다른 학원의 원생 기록을 읽을 수 없습니다");
    const previous = latest.get(fact.id);
    if (previous && previous.at > row.computedAt) continue;
    latest.set(fact.id, { at: row.computedAt, fact: { ...fact, studentId: canonical(fact.studentId),
      related: fact.related.map((r) => r.kind === "student" ? { ...r, id: canonical(r.id) } : r) } });
  }
  return [...latest.values()].map((r) => r.fact);
}
