/**
 * 반 출석 완료 판정(G4) — 순수 함수(Vitest).
 * "그 반·그 날 활성 수강생 전원에게 출결 기록이 존재"하는 순간이 완료 전이다. 셀 단위 저장이라
 * 완료 시점이 모호했던 것을 집합 포함으로 결정론화 — 유예 타이머(서버리스 부적합)·수동 마감 버튼
 * (새 개념) 대신 MVP 채택(로드맵 G4). 판정은 저장 액션이 after() 백그라운드에서 수행.
 */

/** 활성 수강생 전원이 기록됐는가. 수강생 0명(빈 반·데이터 공백)은 완료로 치지 않음(무의미 벨 방지). */
export function isClassAttendanceComplete(
  activeStudentIds: readonly string[],
  recordedStudentIds: ReadonlySet<string>,
): boolean {
  if (activeStudentIds.length === 0) return false;
  return activeStudentIds.every((id) => recordedStudentIds.has(id));
}
