import { assertRaws } from "./calc";
import { METRICS, type Raws } from "./config";

/** Frozen monthly metrics are never reinterpreted as weeks or homework assignments. */
export function normalizeStoredRaws(value: unknown): Raws {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RangeError("Invalid stored contribution raws");
  const raws = Object.fromEntries(METRICS.map(key => [key, (value as Record<string, unknown>)[key]])) as Raws;
  for (const key of ["parentSeminarEvents", "perfectWeeks", "videoAssignments"] as const)
    if (!Object.hasOwn(value, key)) raws[key] = 0;
  assertRaws(raws);
  return raws;
}
/** The original DB guard and older readers require the retired keys. New rows store zero for those units. */
export const rawsForStorage = (raws: Raws) => ({ ...raws, perfectMonths: 0, videoMonths: 0 });
