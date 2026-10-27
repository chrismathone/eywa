import type { StudentFact } from "@/features/students/ontology/types";
import { parentEventFacts, type ParentEventSources } from "./facts";

/** Closed scores stay frozen. Historical event evidence comes from the currently verified set, including later cancellations. */
export function withCurrentParentEvents(input: { tenant: string; month: string; today: string; facts: StudentFact[];
  source: ParentEventSources; canonical: (id: string) => string; eligible: (id: string) => boolean }) {
  if (!input.source.ready) {
    return input.facts.filter(f => f.kind !== "parent_event");
  }
  const current = parentEventFacts({ ...input, capturedAt: input.source.checkedAt ?? `${input.today}T00:00:00+09:00` });
  return [...input.facts.filter(f => f.kind !== "parent_event"), ...current.facts.filter(f => f.occurred.value.startsWith(input.month))];
}
/** Household grouping remains server-side; ordinary student readers receive no cross-student family key. */
export function redactParentEventFact(fact: StudentFact): StudentFact {
  if (fact.kind !== "parent_event") return fact;
  const value = { ...fact.value as Record<string, unknown> };
  delete value.familyKeys;
  return { ...fact, value };
}
