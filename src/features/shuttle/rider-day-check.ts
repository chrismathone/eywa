/**
 * 탑승 학생 시간표의 **보강 이동 계산**(순수 · Vitest) — 사용자 2026-10-29 *"보강이 있으면 얼마나 변경됐는지도 확인되게"*.
 * 보강 이동 = 원래 수업(결석한 날) → 보강 날짜·시각 — 며칠·몇 분 옮겨졌나.
 */
const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));

export type MakeupShift = {
  /** 결석한 날 → 보강 날 사이 날짜 수(뒤로 옮기면 +). */
  days: number;
  /** 원래 시작 → 보강 시작(분, 늦어지면 +). 원래 시각을 모르면 null. */
  startMin: number | null;
};

export function makeupShift(fromDate: string, fromStart: string | null, toDate: string, toStart: string): MakeupShift {
  const d = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`) / 86_400_000;
  return { days: Math.round(d(toDate) - d(fromDate)), startMin: fromStart ? toMin(toStart) - toMin(fromStart) : null };
}

/** "2시간 10분" · "40분" — 부호는 부르는 쪽이 붙인다. */
export function minutesLabel(min: number): string {
  const m = Math.abs(min);
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h && r ? `${h}시간 ${r}분` : h ? `${h}시간` : `${r}분`;
}
