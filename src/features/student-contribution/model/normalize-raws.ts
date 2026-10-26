import { assertRaws } from "./calc";
import type { Raws } from "./config";

/** Expand-only compatibility: only the newly introduced key may be absent in frozen JSON. */
export function normalizeStoredRaws(value: unknown): Raws {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RangeError("Invalid stored contribution raws");
  const raws = { ...value } as Raws;
  if (!Object.hasOwn(value, "parentSeminarEvents")) raws.parentSeminarEvents = 0;
  assertRaws(raws);
  return raws;
}
