import type { EntityRef } from "./types";
import type { LiveEvidence } from "./live-contract";

/** A small managed vocabulary. Role links are assignments, never proof of teaching or learning. */
export const LIVE_RELATION_SCHEMA = {
  enrolledIn: { from: "student", to: "class", label: "수강" },
  homeroom: { from: "class", to: "teacher", label: "담임" },
  scheduledTeacher: { from: "class", to: "teacher", label: "교시 담당" },
  delegatedTeacher: { from: "class", to: "teacher", label: "임시 위임" },
} as const;
export type LiveRelation = {
  tenantId: string; kind: keyof typeof LIVE_RELATION_SCHEMA; from: EntityRef; to: EntityRef;
  asOf: string; version: "student-live-v1";
  /** null = period unknown; through=null within a known period means open-ended. */
  period: { from: string; through: string | null } | null;
  evidence: LiveEvidence[];
};

export function validateLiveRelation(relation: LiveRelation) {
  const schema = LIVE_RELATION_SCHEMA[relation.kind];
  if (!schema || relation.from.kind !== schema.from || relation.to.kind !== schema.to) return "endpoint_type";
  if (!relation.tenantId || !relation.from.id || !relation.to.id || !relation.evidence.length) return "missing_evidence";
  if (relation.period && (relation.period.from > relation.asOf || (relation.period.through !== null && relation.period.through < relation.asOf))) return "inactive_period";
  return null;
}
export function describeTeacherAssignments(relations: readonly LiveRelation[], names: ReadonlyMap<string, string>) {
  return (["homeroom", "scheduledTeacher", "delegatedTeacher"] as const).flatMap((kind) => {
    const ids = [...new Set(relations.filter((r) => r.kind === kind).map((r) => r.to.id))];
    return ids.length ? [`${LIVE_RELATION_SCHEMA[kind].label} ${ids.map((id) => names.get(id) ?? "이름 확인 필요").join(", ")}`] : [];
  }).join(" / ") || "담당자 미지정";
}
