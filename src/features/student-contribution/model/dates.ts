export const isMonth = (month: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
export function isDay(day: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(`${day}T00:00:00Z`))
    && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;
}
/** 2/29→다음 해 2/28, 1/31→다음 달 말일. 12개월 경계 당일부터 재인정한다. */
export function addCalendarMonths(day: string, months: number): string {
  if (!isDay(day) || !Number.isInteger(months)) throw new RangeError("Invalid calendar date");
  const [y, m, d] = day.split("-").map(Number);
  const first = new Date(Date.UTC(y!, m! - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d!, last));
  return first.toISOString().slice(0, 10);
}
