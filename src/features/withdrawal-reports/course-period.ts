/** 달력 기준 온전한 개월 수 + 남은 일수. 월말은 해당 월의 마지막 날로 맞춘다. */
export function courseDuration(from: string, to: string): string {
  const parse = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : new Date(NaN);
  const start = parse(from), end = parse(to);
  if (!Number.isFinite(+start) || !Number.isFinite(+end) || start.toISOString().slice(0, 10) !== from || end.toISOString().slice(0, 10) !== to || end < start) return "기간 확인 필요";
  let months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth();
  const anniversary = (n: number) => {
    const first = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + n, 1));
    const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    first.setUTCDate(Math.min(start.getUTCDate(), last));
    return first;
  };
  if (anniversary(months) > end) months--;
  const days = Math.round((+end - +anniversary(months)) / 86400000);
  return `${months}개월, ${days}일`;
}
