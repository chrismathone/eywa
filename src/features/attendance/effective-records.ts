/**
 * attendance_records는 정정을 새 행으로 남기는 append-only 테이블이다.
 * 학생·반·수업일**·교시**가 같은 행 중 recorded_at이 가장 늦은 행만 현재 유효하다.
 * 같은 트랜잭션에서 시각이 같으면 UUID id 내림차순을 결정적 tie-break로 쓴다(DB RPC와 동일).
 */
export type EffectiveAttendanceRecord = {
  id: string;
  student_id: string;
  class_id: string;
  session_date: string;
  /**
   * 교시(0196a) — **같은 날 교시가 둘이면 서로 다른 기록**이다(원장 2026-08-10: 한 반이 하루에 두 번
   * 만나면 각각 찍는다). null = "그날 전체"(0196a 이전 기록, 그리고 교시를 안 따지는 화면의 기본).
   * ⚠️ `select`에 이 칼럼을 **안 실은 호출부는 undefined**라 예전과 똑같이 (학생·반·날짜)로 접힌다 —
   *    교시를 갈라야 하는 화면만 칼럼을 실으면 되고, 나머지 호출부는 손댈 필요가 없다.
   */
  slot_start?: string | null;
  recorded_at: string;
};

/** 키 구분자 = NUL. 어떤 id·날짜·시각에도 안 나오는 문자라 붙여 쓴 값이 우연히 겹치지 않는다. */
const SEP = String.fromCharCode(0);

function recordKey(row: EffectiveAttendanceRecord): string {
  // ⚠️ 교시가 키에 **들어가야** 한다 — 빠뜨리면 같은 날 4교시·6교시 기록 중 하나가 조용히 사라진다
  //    (화면에선 "쓴 게 안 보임", 집계에선 한 교시가 통째로 누락).
  return [row.student_id, row.class_id, row.session_date, row.slot_start ?? ""].join(SEP);
}

function recordedAtMs(value: string): number {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) throw new RangeError(`Invalid attendance recorded_at: ${value}`);
  return timestamp;
}

/** 입력 순서를 변경하지 않고 각 학생·반·수업일·교시의 최신 정정 행만 반환한다. */
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
