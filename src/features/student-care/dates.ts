import { isValidYmd, kstDateOf } from "@/lib/date-kst";

export function dayOf(value: string | null | undefined): string | null {
  if (!value) return null;
  const datePart = value.slice(0, 10);
  if (isValidYmd(value)) return value;
  // Only timestamps with an explicit zone: never infer the server's local timezone.
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    || !isValidYmd(datePart) || !Number.isFinite(Date.parse(value))) return null;
  const day = kstDateOf(new Date(value));
  return isValidYmd(day) ? day : null;
}
export function dayCount(start: string, end: string): number {
  return Math.round((Date.parse(end + "T00:00:00Z") - Date.parse(start + "T00:00:00Z")) / 86_400_000) + 1;
}
export function uniqueRows<T extends { id: string }>(rows: readonly T[]): T[] {
  return [...new Map(rows.map((row) => [row.id, row])).values()];
}
