import type { AttendanceConfirmedPrice } from "./class-billing";

/** A monthly fee or conflicting prices is not a per-unit price. */
export function actualLessonAmount(prices: readonly AttendanceConfirmedPrice[] | null | undefined, units: number): number | null {
  if (prices?.length !== 1 || prices[0]!.monthly || prices[0]!.daysBasis) return null;
  return Math.round(prices[0]!.unitPrice * units);
}
