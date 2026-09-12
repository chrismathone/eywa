import type { NewcomerRow } from "@/features/newcomers/server/queries";
import { BUCKET_LABEL, NEWCOMER_BUCKETS } from "@/features/newcomers/onboarding-items";
import { subjectGroupOf, type ProgramSubject } from "@/features/students/program";
import type { StudentSubjectSplit, SubjectDistributionRow } from "./student-composition";

type Row = Pick<NewcomerRow, "studentId" | "bucket" | "subject" | "subjects" | "hasCurrentEnrollment">;

/** Fold by student, not subject rows: English + math contributes exactly one violet segment. */
export function newcomerStages(rows: readonly Row[], subjects: readonly ProgramSubject[]): SubjectDistributionRow[] {
  const labels = { d7: "0–7일", d30: "8–30일", d60: "31–60일", d90: "61–90일", over: BUCKET_LABEL.over };
  const groups = new Map(NEWCOMER_BUCKETS.map((bucket) => [bucket, {
    label: labels[bucket], value: 0,
    subjects: { englishOnly: 0, both: 0, mathOnly: 0, otherOnly: 0, noEnrollment: 0 } as StudentSubjectSplit,
  }]));
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.studentId)) continue;
    seen.add(row.studentId);
    const keys = (row.subjects ?? [row]).map((part) => part.subject).filter((key): key is string => !!key);
    const kinds = new Set(keys.map((key) => subjectGroupOf(key, subjects)));
    const english = kinds.has("english");
    const math = kinds.has("math");
    const category = english && math ? "both" : english ? "englishOnly" : math ? "mathOnly"
      : keys.length || row.hasCurrentEnrollment ? "otherOnly" : "noEnrollment";
    const group = groups.get(row.bucket)!;
    group.subjects[category] += 1;
    group.value += 1;
  }
  return [...groups.values()];
}
