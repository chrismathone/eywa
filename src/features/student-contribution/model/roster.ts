import { isBookkeepingOnlyExit } from "@/features/withdrawals/system-bulk";
import { isMergedStudent } from "@/features/students/status/merged";
import type { ContributionStudent } from "../server/source-types";

export type ContributionRosterStudent = Omit<ContributionStudent, "parent_phone" | "makeedu_id">;
export function contributionRoster<T extends ContributionRosterStudent>(students: readonly T[], enrolled: ReadonlySet<string>) {
  return students.filter((s) => !s.is_test && !isMergedStudent(s.notes)
    && !isBookkeepingOnlyExit({ withdrawalMetadata: s.withdrawal_metadata, hasEnrollmentHistory: enrolled.has(s.id) }));
}
