import { KNOWN_SUBJECT_KEYS } from "@/features/owner/subjects";

/** Keep an explicit consultation subject; fill only when the counselor has one subject. */
export function consultationSubject(
  entered: string | null,
  counselorSubjects: readonly string[] | null | undefined,
  labels: Record<string, string>,
): string | null {
  if (entered?.trim()) return entered.trim();
  if (!counselorSubjects || counselorSubjects.length !== 1) return null;
  const key = counselorSubjects[0];
  return labels[key] ?? Object.entries(KNOWN_SUBJECT_KEYS).find(([, value]) => value === key)?.[0] ?? null;
}
