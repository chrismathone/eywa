import { z } from "zod";
import { isRecord } from "@/lib/guards";

export const payslipManagerIdsSchema = z.array(z.string().uuid()).max(80);

/** Inspect RAW presence before default merging. Explicit invalid values deny; only absence inherits. */
export function effectivePayslipManagerIds(specialAccess: unknown): string[] {
  if (!isRecord(specialAccess)) return [];
  const raw = Object.hasOwn(specialAccess, "payslipManagerIds")
    ? specialAccess.payslipManagerIds
    : specialAccess.payslipViewerIds;
  const parsed = payslipManagerIdsSchema.safeParse(raw);
  return parsed.success && new Set(parsed.data).size === parsed.data.length ? [...parsed.data] : [];
}

/** Old forms cannot express whether a viewer change should also change management. */
export function payslipRefreshRequired(input: unknown, previous: unknown): boolean {
  const sent = isRecord(input) && isRecord(input.specialAccess) ? input.specialAccess : {};
  if (Object.hasOwn(sent, "payslipManagerIds") || !Object.hasOwn(sent, "payslipViewerIds")) return false;
  const stored = isRecord(previous) && isRecord(previous.specialAccess) ? previous.specialAccess : {};
  const sorted = (value: unknown) => JSON.stringify(Array.isArray(value) ? [...value].sort() : []);
  return sorted(sent.payslipViewerIds) !== sorted(stored.payslipViewerIds);
}
