/**
 * 저장된 절대시각 슬롯을 학원설정 교시로 되돌리는 순수 매처.
 *
 * 시작시각만으로는 교시를 식별할 수 없다. 실제 영어 설정에는
 * `EiE 4교시(16:20~17:00)`와 `IJW 1교시(16:20~17:20)`처럼 시작이 같은 행이 공존한다.
 * 정확한 (시작, 종료) 쌍을 먼저 보고, 레거시 종료시각 불일치 데이터만 시작시각으로 폴백한다.
 */

export type PeriodMatchRow = { id: string; startTime: string; endTime: string };

const hm = (t: string | null | undefined) => String(t ?? "").slice(0, 5);

export function buildPeriodMatcher(periods: readonly PeriodMatchRow[]) {
  const exact = new Map<string, string>();
  const byStart = new Map<string, string>();
  for (const p of periods) {
    const pair = `${hm(p.startTime)}|${hm(p.endTime)}`;
    if (!exact.has(pair)) exact.set(pair, p.id);
    if (!byStart.has(hm(p.startTime))) byStart.set(hm(p.startTime), p.id);
  }
  return (slot: { startTime: string; endTime?: string | null }): string | null =>
    exact.get(`${hm(slot.startTime)}|${hm(slot.endTime)}`) ?? byStart.get(hm(slot.startTime)) ?? null;
}
