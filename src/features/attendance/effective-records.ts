/**
 * attendance_records는 정정을 새 행으로 남기는 append-only 테이블이다.
 * 학생·반·수업일이 같은 행 중 recorded_at이 가장 늦은 행만 현재 유효하다.
 * 같은 트랜잭션에서 시각이 같으면 UUID id 내림차순을 결정적 tie-break로 쓴다(DB RPC와 동일).
 */
export type EffectiveAttendanceRecord = {
  id: string;
  student_id: string;
  class_id: string;
  session_date: string;
  recorded_at: string;
};

function recordKey(row: EffectiveAttendanceRecord): string {
  return `${row.student_id}\u0000${row.class_id}\u0000${row.session_date}`;
}

function recordedAtMs(value: string): number {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) throw new RangeError(`Invalid attendance recorded_at: ${value}`);
  return timestamp;
}

/** 입력 순서를 변경하지 않고 각 학생·반·수업일의 최신 정정 행만 반환한다. */
export function effectiveAttendanceRecords<T extends EffectiveAttendanceRecord>(
  rows: readonly T[],
): T[] {
  const effective = new Map<string, { row: T; recordedAt: number }>();

  for (const row of rows) {
    const key = recordKey(row);
    const recordedAt = recordedAtMs(row.recorded_at);
    const previous = effective.get(key);
    if (
      !previous ||
      recordedAt > previous.recordedAt ||
      (recordedAt === previous.recordedAt && row.id > previous.row.id)
    ) {
      effective.set(key, { row, recordedAt });
    }
  }

  return [...effective.values()].map(({ row }) => row);
}
