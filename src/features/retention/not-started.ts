/**
 * 리텐션 명단에서 뺄 **'아직 한 과목도 시작 안 한' 재원생** — 순수(Vitest).
 *
 * 재원생은 '실시간'으로 센다(원장 2026-09-16, docs/decisions/students.md): 등록은 확정됐지만 아직 교실에 앉지 않은
 * 학생(활성 수강이 전부 미래 시작)은 재원생 숫자에도 명단에도 넣지 않는다. 원생목록·운영실·슈퍼관리자 화면이 이미
 * 그렇게 세고, 리텐션만 남아 있었다(운영점검 2026-10-03 A02 — 리텐션 335명 대 원생목록 334명).
 *
 * 🔴 판정을 새로 짓지 않는다 — 원생목록과 **같은 함수**(`notYetStartedStudentIds`)에 **같은 재료 조건**으로 넘긴다:
 *    종료 안 됨(`end_date` 없음) · 휴원 아님(`on_hold = false`). 원생목록의 조회(`fetchActiveEnrolledEnrollments`)가
 *    SQL로 거는 조건과 같은 것을 여기서는 받아 온 줄에 건다(리텐션은 끝난 수강·휴원 수강도 다른 용도로 받아 온다).
 *    전 줄을 그대로 넘기면 "끝난 옛 수강 + 미래 시작 수강"인 학생이 '이미 시작'으로 읽혀 한 명이 다시 어긋난다.
 *
 * 결과(다섯 사례 — 테스트가 고정한다):
 *   · 수강 없음              → 남는다(반 배정 전 신입 — 뺄 근거가 없다)
 *   · 미래 시작 수강만        → 빠진다
 *   · 미래 시작 + 이미 시작   → 남는다
 *   · 끝난 수강 + 미래 시작   → 빠진다
 *   · 휴원 중인 수강만        → 남는다(휴원 수강은 재료가 아니다 = 수강 없음과 같은 취급)
 *   · 시작일을 모르는 수강    → 남는다(모름을 '미시작'으로 읽지 않는다)
 */
import { notYetStartedStudentIds } from "@/features/students/enrolled-composition";

export type RetentionEnrollmentSpan = {
  student_id: string;
  start_date?: string | null;
  end_date: string | null;
  on_hold: boolean | null;
};

/** @param today KST 오늘(`YYYY-MM-DD`). */
export function retentionNotStartedStudentIds(
  enrollments: readonly RetentionEnrollmentSpan[],
  today: string,
): Set<string> {
  return notYetStartedStudentIds(
    enrollments.filter((e) => e.end_date == null && e.on_hold === false),
    today,
  );
}
