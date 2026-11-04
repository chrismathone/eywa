import { checkFromRow, DONE_CHECK, type BeforeClassCheck } from "./items";

export type DayCheckRow = {
  class_id: string; student_id: string; missed: unknown; absent: boolean | null; card: unknown;
  excused?: boolean | null; excuse_reason?: unknown; excuse_note?: string | null;
};

/**
 * 수학 보고서에 붙일 그 학생의 그날 체크 하나를 고른다(원장 2026-10-30 *"MS2A랑 JJ2A 묶고 JJ1A랑 MS1A랑 엮어서"* ·
 * *"수학보고서는 jj에서 나갈일없고 ms에서 합쳐서 나가자나"*). 체크는 JJ반에서 하고 보고서는 MS반에서 나가므로
 * **반이 아니라 학생**으로 찾는다 — 그날 그 학생이 명단에 있는 체크리스트 반(`rosterClassIds`, 보고서 반 포함) 전부의 체크.
 * 짝을 따로 저장하지 않는다: 두 반 명단이 같아 학생이 둘 다에 서 있으면 그게 짝이다(반 이름·사람 이름을 코드에 적지 않는다).
 *   ① 그 학생 행이 있으면 그 행(결석이 아닌 행 먼저) — 결석이면 reportCheckRows가 줄을 안 낸다(MS 출결은 보지 않는다)
 *   ② 행이 없어도 그날 체크가 하나라도 있는 반의 명단이면 '모두 해 옴'
 *   ③ 아무 반도 체크하지 않은 날 → null(줄 없음)
 */
export function pickReportCheck(rows: readonly DayCheckRow[], rosterClassIds: ReadonlySet<string>, studentId: string): BeforeClassCheck | null {
  const inRoster = rows.filter((r) => rosterClassIds.has(r.class_id));
  const mine = inRoster.filter((r) => r.student_id === studentId);
  const row = mine.find((r) => !r.absent) ?? mine[0];
  if (row) return checkFromRow(row);
  return inRoster.length ? DONE_CHECK : null;
}
