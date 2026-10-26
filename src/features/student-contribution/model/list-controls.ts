export const CHANGE_PERIODS = [1, 3, 6, 12] as const;
export type ChangePeriod = typeof CHANGE_PERIODS[number];
export const changePeriod = (value: unknown): ChangePeriod => CHANGE_PERIODS.find((n) => n === Number(value)) ?? 12;
export const changePeriodLabel = (period: ChangePeriod) => period === 1 ? "이번 달" : `최근 ${period}개월`;

/** Missing scores always stay last, in either direction. Equal scores have a stable name/id order. */
export function compareListScores(a: { id: string; name: string; value: number | null }, b: { id: string; name: string; value: number | null }, direction: "asc" | "desc") {
  if (a.value === null && b.value !== null) return 1;
  if (b.value === null && a.value !== null) return -1;
  return ((a.value ?? 0) - (b.value ?? 0)) * (direction === "asc" ? 1 : -1)
    || a.name.localeCompare(b.name, "ko") || a.id.localeCompare(b.id);
}
