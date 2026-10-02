/**
 * 관리자 직접 작성(수업보고서)의 **과목 기본값** — 순수 함수(클라·서버 공용).
 *
 * 과목이 곧 알림장(보드)이다: 수학 보고서는 `(수학)이름`, 영어 보고서는 `(영어)이름`으로 나간다.
 * 예전엔 학생을 고르면 '발송 가능한 첫 과목'이 자동으로 잡혔는데, 그 순서는 수강 조회 순서(정렬 없음)라
 * 수학·영어를 다 듣는 학생은 어느 쪽이 잡힐지 정해져 있지 않았다 — 그대로 쓰면 수학 보고서가 영어 알림장으로 나간다
 * (2026-10-02 교재 발송에서 실제로 난 사고와 같은 모양: 가나다순 첫 과목).
 *
 * 규칙: **고를 알림장이 하나뿐일 때만** 자동 선택한다. 둘 이상이면 고르지 않는다(화면이 과목을 고르게 한다).
 *  - 수강 중인 발송 가능 과목이 한 알림장으로 모이면 그 과목(같은 보드로 가는 math·subject_1은 하나로 본다).
 *  - 수강 중인 발송 가능 과목이 없으면(테스트 학생 등) 학원 발송 과목이 한 알림장일 때만 그것.
 */
export type ComposeSubjectChoice = { key: string; sendable: boolean; board: string | null };

export function defaultComposeSubject<T extends ComposeSubjectChoice>(enrolled: T[], fallback: T[]): T | null {
  const boardOf = (s: T) => s.board ?? s.key;
  const sendable = enrolled.filter((s) => s.sendable);
  if (sendable.length) return new Set(sendable.map(boardOf)).size === 1 ? sendable[0]! : null;
  return fallback.length && new Set(fallback.map(boardOf)).size === 1 ? fallback[0]! : null;
}
