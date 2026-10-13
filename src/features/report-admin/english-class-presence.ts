/**
 * 영어 작성률 분모의 재원 판정 — 그날 그 반에 보고서를 받을 학생이 있나.
 *
 * 영어 작성률은 반 단위(ClassNote 반 보드 게시일)라 학생 명단을 따로 안 봤다. 그래서 재원생이 0명인
 * 반도 시간표 요일마다 '안 쓴 날'로 셌다(2026-10-13 실측: 그런 반 2개). 작성률 화면과 운영실
 * '선생님 할 일'이 **같은 판정**을 쓰도록 여기 한 곳에 둔다.
 */
import { enrollmentAttendsOnDay, isEnrollmentActiveOn } from "@/features/enrollments/eligibility";
import { dowOf } from "./english-writing";

/** 재원 판정 재료 — `enrollments` 한 행(DB 컬럼 이름 그대로). */
export type ClassEnrollmentRow = {
  class_id: string;
  start_date: string | null;
  end_date: string | null;
  on_hold: boolean | null;
  is_transferred: boolean | null;
  attendance_days: string[] | null;
};

/**
 * (반, 날짜) → 그날 그 반에 **수강 중이고 그 요일에 오는 학생이 하나라도 있나**.
 * 수강 판정은 출결·운영실 작성 대상과 같은 함수(`isEnrollmentActiveOn` — 휴원 제외·반이동 반열림 /
 * `enrollmentAttendsOnDay` — 분리등원). 테스트 학생은 호출부가 조회에서 뺀다.
 * ⚠️ **결석은 보지 않는다** — 수학 작성 대상은 그날 결석생을 빼지만, 영어는 반 알림장 하나라
 *    전원 결석인 날도 그대로 센다(원장 지시 범위 = 수강·등원 요일, 2026-10-13).
 * ⚠️ `on_hold`는 '지금 상태'라 지난 날짜에도 소급된다(수학 과거일 대상과 같은 한계).
 */
export function buildHasStudentsOn(rows: readonly ClassEnrollmentRow[]): (classId: string, date: string) => boolean {
  const byClass = new Map<string, ClassEnrollmentRow[]>();
  for (const r of rows) byClass.set(r.class_id, [...(byClass.get(r.class_id) ?? []), r]);
  return (classId, date) =>
    (byClass.get(classId) ?? []).some(
      (e) =>
        isEnrollmentActiveOn(
          {
            startDate: e.start_date ?? "0000-01-01",
            endDate: e.end_date,
            onHold: e.on_hold === true,
            isTransferred: e.is_transferred === true,
          },
          date,
        ) && enrollmentAttendsOnDay(e.attendance_days, dowOf(date)),
    );
}
