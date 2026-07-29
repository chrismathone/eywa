// 교시 라벨 해석(표시 전용) — 순수 함수(Vitest로 잠금).
//
// 왜 표가 둘인가: 주말은 **평일과 시각이 다른 별도 교시표**를 쓴다(주말 09:00~ 1시간 단위 /
// 영어 평일 14:20~ 40분 단위). ECS가 평일표만 보고 라벨을 붙이던 탓에 주말 15:00~16:00 수업이
// 평일 "2교시"(=15:00~15:40)로 표시됐다 — 시각이 다른 교시를 같은 번호로 부르는 거짓 표시였다
// (원장 제보 2026-07-29 "시간은 주말시간을 그대로 유지해야지").
//
// 왜 단순히 "주말이면 주말표"가 아닌가: 실데이터상 **주말인데 영어 평일 시각(14:20/15:00/15:40)을
// 쓰는 반이 실재**한다(sat 3반·sun 1반). 그 요일의 표만 보면 그 반들이 라벨을 통째로 잃는다.
// → **시작+종료가 정확히 일치**할 때만 다른 표를 교차 참조한다(강한 신호). 시작만 같은 추측 매칭은
//   그 요일의 표에서만 허용 — 시각이 다른 교시에 남의 번호를 붙이는 게 이 버그의 원인이었다.
export type PeriodEntry = { id: string; startTime: string; endTime: string };
export type PeriodTables = { weekday: PeriodEntry[]; weekend: PeriodEntry[] };

export function tableToEntries(table: Record<string, { startTime: string; endTime: string }>): PeriodEntry[] {
  return Object.entries(table).map(([id, t]) => ({ id, startTime: t.startTime, endTime: t.endTime }));
}

export function resolvePeriodLabel(
  slotStart: string,
  slotEnd: string | null,
  tables: PeriodTables,
  isWeekend: boolean,
): string | null {
  const primary = isWeekend ? tables.weekend : tables.weekday;
  const secondary = isWeekend ? tables.weekday : tables.weekend;
  const exact = (t: PeriodEntry[]) =>
    slotEnd === null ? undefined : t.find((p) => p.startTime === slotStart && p.endTime === slotEnd);
  const byStart = (t: PeriodEntry[]) => t.find((p) => p.startTime === slotStart);
  // ① 그 요일 표에 시작+종료 일치 → ② 다른 표에 시작+종료 일치(교차, 강한 신호만)
  // → ③ 그 요일 표에 시작만 일치(고아 슬롯 등 종료 미상). 넷 다 없으면 **라벨 없음**(지어내지 않는다).
  const hit = exact(primary) ?? exact(secondary) ?? byStart(primary);
  return hit ? `${hit.id}교시` : null;
}
