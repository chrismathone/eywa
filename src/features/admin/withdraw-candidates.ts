// 자동 퇴원 후보 판정 — 순수 함수(테스트 강제). UI·DB 비의존.
//
// 규칙(원장 확정 2026-07-15): "수강 없는 재원생"이라고 바로 퇴원 후보로 올리지 않는다.
// 반 폐지·종강은 그 반 수강을 종료시키므로 학생이 잠시 '수업 없는 재원생'이 되는데, 그건 퇴원이 아니라
// **재배정 대기**다(대시보드 '반 미배정 재원생'이 잡아준다). 마지막 수강이 끝난 지 30일이 지난 학생만
// 이력이 실제로 상실된 것으로 보고 후보에 올린다.

/** 자동 퇴원 후보 게이트 기준일수. */
export const WITHDRAW_CANDIDATE_DAYS = 30;

export type WithdrawCandidateInput = {
  /** 마지막 수강 종료일(YYYY-MM-DD). 수강 이력이 없으면 등록일, 둘 다 없으면 null. */
  lastEndedAt: string | null;
};

/**
 * cutoff(=오늘-30일) 이전에 수강이 끊긴 학생만 후보.
 * lastEndedAt이 null = 마지막 수강 종료일도 등록일도 모르는 학생 → **후보에서 제외**한다(보수적).
 * 30일이 지났음을 증명할 수 없는 학생을 퇴원시키는 건 되돌리기 번거로운 오작동이라, 모르면 안 건드린다.
 */
export function isWithdrawCandidate(input: WithdrawCandidateInput, cutoff: string): boolean {
  if (!input.lastEndedAt) return false;
  return input.lastEndedAt <= cutoff;
}

/** 후보만 남긴다(입력 순서 보존). */
export function selectWithdrawCandidates<T extends WithdrawCandidateInput>(
  students: T[],
  cutoff: string,
): T[] {
  return students.filter((s) => isWithdrawCandidate(s, cutoff));
}
