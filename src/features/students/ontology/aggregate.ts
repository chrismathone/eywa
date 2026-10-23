import { uniqueStudentFacts } from "./facts";
import type { EntityRef, StudentFact } from "./types";

/** 집계 축은 여러 관계를 가질 수 있다. 같은 사실 id는 학원 전체에서 한 번만 센다. */
export function aggregateStudentOntology(tenant: string, input: readonly StudentFact[], scope: EntityRef) {
  if (scope.kind === "academy" && scope.id !== tenant) throw new Error("학원 연결을 확인해 주세요");
  const all = uniqueStudentFacts(tenant, [input]);
  const facts = all.filter((f) => scope.kind === "academy" || (scope.kind === "student" && f.studentId === scope.id)
    || f.related.some((r) => r.kind === scope.kind && r.id === scope.id));
  const counts: Partial<Record<StudentFact["kind"], number>> = {};
  let tuitionWon = 0, unallocatedTuitionFacts = 0;
  for (const f of facts) {
    counts[f.kind] = (counts[f.kind] ?? 0) + 1;
    if (f.kind !== "tuition" || f.state !== "active") continue;
    const v = f.value as { tuitionWon?: number };
    // 여러 과목의 합계 금액을 각 과목·반·강사에게 복제하지 않는다.
    const explicit = scope.kind === "academy" || scope.kind === "student"
      || (scope.kind === "subject" && f.related.filter((r) => r.kind === "subject").length === 1);
    if (explicit && typeof v.tuitionWon === "number") tuitionWon += v.tuitionWon;
    else unallocatedTuitionFacts++;
  }
  return { facts, students: [...new Set(facts.map((f) => f.studentId))], counts, tuitionWon, unallocatedTuitionFacts };
}
