/**
 * 시간표 메뉴의 첫 과목. available은 이미 학원 설정·주간 배치·강사 범위로 좁힌 목록이다.
 * 담당 과목은 기본 선택에만 쓰며 열람 권한이나 과목 목록을 넓히지 않는다.
 * 여러 과목을 맡으면 학원에서 정한 과목 순서를 따른다. 명시한 링크는 항상 우선한다.
 */
export function resolveTimetableSubject(
  available: readonly string[],
  staffSubjects: readonly string[] | null | undefined,
  requested?: string,
): string {
  if (requested && available.includes(requested)) return requested;
  return available.find((subject) => staffSubjects?.includes(subject)) ?? available[0] ?? "";
}
