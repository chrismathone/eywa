/**
 * 출석 **입력 폼**에 그 행을 띄울지 판정 — 순수 함수(서버 쿼리에서 분리, Vitest 강제).
 *
 * 규약 두 줄:
 * 1. 새 입력은 **그 날짜에 실제 오는 학생만** — 판정은 공용 헬퍼(isEnrollmentActiveOn·enrollmentAttendsOnDay)
 *    단일 소스. 손으로 다시 구현하면 처리현황과 명단이 갈린다(2026-07-22 실측 월7·화7·목9·금5명).
 * 2. **이미 기록이 있으면 무조건 남긴다** — 안 그러면 과거에 찍힌 기록이 화면에서 사라져 수정·삭제가
 *    불가능해진다(실측 52행). "안 보이는데 존재하는 데이터"를 만들지 않는 게 이 규약의 핵심이다.
 */
import { enrollmentAttendsOnDay, isEnrollmentActiveOn } from "@/features/enrollments/eligibility";

export type AttendanceInputCandidate = {
  startDate: string;
  endDate: string | null;
  onHold: boolean;
  isTransferred?: boolean;
  attendanceDays: readonly string[] | null;
};

export function includeInAttendanceInput(
  enrollment: AttendanceInputCandidate,
  date: string,
  dayKey: string,
  hasRecord: boolean,
): boolean {
  if (hasRecord) return true;
  return activeAndAttending(enrollment, date, dayKey);
}

function activeAndAttending(
  enrollment: AttendanceInputCandidate,
  date: string,
  dayKey: string,
): boolean {
  if (
    !isEnrollmentActiveOn(
      {
        startDate: enrollment.startDate,
        endDate: enrollment.endDate,
        onHold: enrollment.onHold,
        isTransferred: enrollment.isTransferred,
      },
      date,
    )
  ) {
    return false;
  }
  return enrollmentAttendsOnDay(enrollment.attendanceDays, dayKey);
}

/**
 * 보강(수업외) 참석자 = 그 (반,날짜)에 **기록은 있는데 그 반 수강행이 없는** 학생.
 *
 * 출석 입력 화면이 이들을 명단에 합치지 않으면, 강사가 '+ 보강 학생 추가'로 저장한 행이 다음 로드에서
 * 통째로 사라져 **수정·삭제할 방법이 없어진다**(수강행이 없어 enrollments 쿼리에 절대 안 걸리므로).
 * 이관분에도 이런 행이 많다(실측 1,264행 / 2026-02~06) — 과거 날짜를 열면 그것도 함께 드러난다.
 */
export function makeupStudentIds(
  recordedStudentIds: readonly string[],
  enrolledStudentIds: readonly string[],
): string[] {
  const enrolled = new Set(enrolledStudentIds);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of recordedStudentIds) {
    if (enrolled.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
