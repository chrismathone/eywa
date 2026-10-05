/** 연결되지 않은 옛 예약만 기존 이행을 탄다. 같은 학생의 연결이 둘이면 둘 다 멈춘다. */

export type LegacyRow = { id: string; studentId: string; mapped: boolean };

export function splitLegacyBatch(rows: readonly LegacyRow[]): {
  project: LegacyRow[];
  hold: LegacyRow[];
  fulfil: LegacyRow[];
} {
  const mappedCount = new Map<string, number>();
  for (const row of rows) {
    if (!row.mapped) continue;
    mappedCount.set(row.studentId, (mappedCount.get(row.studentId) ?? 0) + 1);
  }
  const project: LegacyRow[] = [];
  const hold: LegacyRow[] = [];
  const fulfil: LegacyRow[] = [];
  for (const row of rows) {
    if (!row.mapped) fulfil.push(row);
    else if ((mappedCount.get(row.studentId) ?? 0) === 1) project.push(row);
    else hold.push(row);
  }
  return { project, hold, fulfil };
}
