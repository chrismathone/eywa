import {
  ONBOARDING_ITEMS,
  statusOf,
  type OnboardingItemStatus,
} from "@/features/newcomers/onboarding-items";
import type { CareRow } from "@/features/newcomers/care-cells";

/** Evaluate each subject's own first class date; only then collapse to one student. */
export function careStatus(
  item: (typeof ONBOARDING_ITEMS)[number],
  row: CareRow,
  today: string,
): OnboardingItemStatus {
  const rows = row.subjects?.length ? row.subjects : [row];
  const statuses = rows.map((subject) =>
    statusOf(item, subject, subject.checks[item.key], today),
  );
  if (statuses.every((s) => s === "done")) return "done";
  return (
    (["overdue", "due", "pending", "upcoming", "waived"] as const).find(
      (status) => statuses.includes(status),
    ) ?? "pending"
  );
}
