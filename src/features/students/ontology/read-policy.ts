import type { StudentFact } from "./types";

/** Apply BEFORE canonicalization: a merge never grants access to a former student's source. */
export function canReadFactSource(fact: StudentFact, readable: ReadonlySet<string> | null) {
  if (fact.access === "billing" || readable === null) return true;
  const prospect = fact.kind === "referred" && fact.value && typeof fact.value === "object" && "prospectId" in fact.value ? fact.value.prospectId : null;
  return readable.has(fact.studentId) && fact.evidence.every((e) => readable.has(e.studentId))
    && fact.related.every((e) => e.kind !== "student" || readable.has(e.id))
    && (typeof prospect !== "string" || readable.has(prospect));
}

export type EvidenceStatus = "current" | "changed" | "unavailable";
/** A damaged relationship must not break an otherwise readable student's frozen month. */
export function canResolveFactSource(fact: StudentFact, canonical: (id: string) => string) {
  try {
    const ids = [fact.studentId, ...fact.evidence.map((e) => e.studentId), ...fact.related.flatMap((r) => r.kind === "student" ? [r.id] : [])];
    return ids.every((id) => !!canonical(id));
  } catch { return false; }
}
export function signalEvidenceStatus(stored: { student_id: string; source_hash: string },
  source: { studentId: string; hash: string } | undefined): EvidenceStatus {
  if (!source) return "unavailable";
  return source.studentId === stored.student_id && source.hash === stored.source_hash ? "current" : "changed";
}
