/**
 * 출결 쓰기 — 그 (반·학생)을 쓸 수 있는가. 순수(Vitest).
 *
 * 정규 수강생이 기본이고, **보강(수업외)** 은 수강행이 없어도 쓴다.
 *  · `allowMakeup` = 지금 보강으로 넣는 저장(출석부·ECS·원스크린 '+ 보강 학생 추가')
 *  · `hasRecord`   = 그 (반·날짜)에 이미 기록이 있다 — 예전에 보강으로 넣은 칸을
 *    다른 화면에서 고치거나 지울 때. 수강 게이트만 보면 "안 보이는데 존재하는 데이터"가 된다.
 *
 * 🔴 담당 반·7일 창은 여기 없다 — 호출부가 먼저 통과시킨다. 여기는 **학생 결속**만.
 */
export function canWriteAttendanceStudent(input: {
  enrolled: boolean;
  hasRecord: boolean;
  allowMakeup: boolean;
  /** 새 보강 참여가 그 반·날짜에 있을 때만. 조회 실패는 호출부가 먼저 돌려보낸다. */
  nativeParticipant?: boolean;
}): boolean {
  return input.enrolled || input.hasRecord || input.allowMakeup || input.nativeParticipant === true;
}
