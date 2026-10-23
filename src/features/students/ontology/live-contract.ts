/** Live source reads are separate from frozen contribution facts. Unknown is never zero. */
import { validateLiveRelation, type LiveRelation } from "./live-relations";
export const LIVE_RELATION_VERSION = "student-live-v1";
export type ReadState = "ready" | "partial" | "forbidden" | "off" | "schema_missing" | "failed";
export type LiveEvidence = { source: string; id: string; studentId: string; href: string };
export type LiveItem = { id: string; title: string; detail: string; date?: string; evidence: LiveEvidence[]; relations?: LiveRelation[]; subject?: string; summaryExcluded?: boolean };
export type LiveSection = {
  key: string; label: string; state: ReadState; items: LiveItem[];
  /** null = cannot establish a count. items.length is not the total. */
  total: number | null; href: string; note?: string;
};
export type LiveConnections = { studentId: string; asOf: string; checkedAt: string; ruleVersion: string; sections: LiveSection[] };

/** Current date endpoints follow source enrollment/schedule inclusive end-date semantics. */
export function activeOn(day: string, from: string | null, through: string | null) {
  return (!from || from <= day) && (!through || through >= day);
}

export function sectionResult(key: string, label: string, href: string,
  rows: LiveItem[], total: number): LiveSection {
  if (!Number.isInteger(total) || total < rows.length) throw new Error("원본 건수를 확인해 주세요");
  return { key, label, href, items: rows, total, state: "ready" };
}

/** Structured validation belongs here; probabilistic AI suggestions cannot repair factual links. */
export function validateLiveSection(section: LiveSection) {
  const issues: { itemId: string; code: "missing_evidence" | "invalid_link" | "duplicate_id" | "invalid_relation" }[] = [];
  const ids = new Set<string>();
  for (const item of section.items) {
    if (ids.has(item.id)) issues.push({ itemId: item.id, code: "duplicate_id" });
    if (item.relations?.some((r) => validateLiveRelation(r))) issues.push({ itemId: item.id, code: "invalid_relation" });
    ids.add(item.id);
    if (!item.evidence.length) issues.push({ itemId: item.id, code: "missing_evidence" });
    if (item.evidence.some((e) => !e.id || !e.studentId || !e.source || !/^\/(?!\/)[^\\\u0000-\u001f]*$/.test(e.href))) {
      issues.push({ itemId: item.id, code: "invalid_link" });
    }
  }
  return issues;
}
