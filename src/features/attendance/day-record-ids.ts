/**
 * 한 반·한 날짜의 **유효 기록 id**를 학생별로 — (학생·교시)마다 가장 최근 1건(0196a · 옛 정정본은 뺀다).
 * 일별 입력 화면(`getAttendanceInputRows`)이 폼에 싣는 `recordIds`와 같은 규칙이다. 저장(`saveAttendance`)은 폼이 보낸
 * id를 믿지 않고 이 함수로 서버에서 다시 고른다(수정 계획 P1-A 4-4, 결정 #5 ③ — 클라 `existingIds` 불신).
 *
 * @param rows `recorded_at` 내림차순 → `id` 내림차순으로 정렬된 행(조회가 정렬해서 넘긴다).
 */
export function dayRecordIdsByStudent(
  rows: readonly { id: string; student_id: string; slot_start: string | null }[],
): Map<string, string[]> {
  const seen = new Set<string>();
  const out = new Map<string, string[]>();
  for (const r of rows) {
    const k = `${r.student_id}|${r.slot_start ?? ""}`;
    if (seen.has(k)) continue; // 같은 교시의 옛 정정본
    seen.add(k);
    const ids = out.get(r.student_id);
    if (ids) ids.push(r.id);
    else out.set(r.student_id, [r.id]);
  }
  return out;
}
