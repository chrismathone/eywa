import { z } from "zod";

const idsSchema = z.array(z.string().uuid()).max(80);
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Only raw absence means legacy. Invalid explicit values revoke access. */
export function studentStatusManagerIds(special: unknown): string[] | undefined {
  if (special === undefined) return undefined;
  if (!record(special)) return [];
  if (!Object.hasOwn(special, "studentStatusManagerIds") || special.studentStatusManagerIds === undefined) return undefined;
  const parsed = idsSchema.safeParse(special.studentStatusManagerIds);
  return parsed.success && new Set(parsed.data).size === parsed.data.length ? [...parsed.data] : [];
}

/** Legacy menu grants cannot silently grant status authority to another person. */
export function studentStatusRefreshRequired(input: unknown, previous: unknown): boolean {
  const sent = record(input) ? input : {};
  const stored = record(previous) ? previous : {};
  if (record(sent.specialAccess) && Object.hasOwn(sent.specialAccess, "studentStatusManagerIds")) return false;
  if (studentStatusManagerIds(stored.specialAccess) !== undefined) return false;
  const rows = (value: unknown) => JSON.stringify((Array.isArray(value) ? value : [])
    .filter((r) => record(r) && r.menu === "students")
    .map((r) => JSON.stringify(r)).sort());
  return ["overrides", "userOverrides"].some((key) => Object.hasOwn(sent, key) && rows(sent[key]) !== rows(stored[key]));
}
