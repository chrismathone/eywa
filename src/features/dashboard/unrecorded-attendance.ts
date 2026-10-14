import { enrollmentAttendsOnDay, isEnrollmentActiveOn } from "@/features/enrollments/eligibility";

/** 판정이 읽는 수강 칸 — 운영실 신호·강사별 업무 현황이 받는 행 모양 그대로. */
export type UnrecordedEnrollment = {
  student_id: string;
  start_date: string | null;
  end_date: string | null;
  on_hold: boolean | null;
  is_transferred: boolean | null;
  attendance_days: string[] | null;
};

/**
 * 그 반 그날 **출결을 다 못 찍었나** — 운영실 '어제 출결 미입력' 신호([`action-signals.ts`](./server/action-signals.ts))와
 * '강사별 업무 현황'의 출결 미입력 행이 함께 쓰는 판정(순수 · 같은 원본).
 *  · 명단 = 그날 유효한 수강(휴원·반이동 종료 제외 · `isEnrollmentActiveOn`) + 그날 등원 요일(분리등원) · 빼는 학생(테스트 학생) 제외.
 *  · 명단 중 한 명이라도 그 반 그날 출결 기록이 없으면 미입력. 명단이 비면 대상이 아니다(`expected` 0 — 수강 없는 반).
 *  · 시작일이 없는 수강은 명단에 넣지 않는다 — 신호가 처음부터 `start_date <= 그날`로 조회해 온 판정과 같게.
 * ⚠️ 그날 수업이 있는 반인지(시간표)·휴원일인지는 호출부가 고른다(신호 = 그 요일 시간표가 있는 반 · 카드 = 같은 판정 + 학원설정 휴원일 제외).
 */
export function judgeClassAttendanceDay(input: {
  enrollments: readonly UnrecordedEnrollment[];
  /** 그 반 그날 출결 기록이 있는 학생. */
  recorded: ReadonlySet<string>;
  date: string;
  /** `sun`…`sat` — 등원 요일 판정 키. */
  dayKey: string;
  excluded?: ReadonlySet<string>;
}): { expected: number; unrecorded: boolean } {
  const expected = new Set<string>();
  for (const e of input.enrollments) {
    if (!e.start_date) continue;
    const active = isEnrollmentActiveOn(
      { startDate: e.start_date, endDate: e.end_date, onHold: e.on_hold === true, isTransferred: e.is_transferred === true },
      input.date,
    );
    if (!active || !enrollmentAttendsOnDay(e.attendance_days, input.dayKey)) continue;
    // 판정(그날 유효·등원 요일) 뒤에 뺀다 — 처리현황과 같은 순서. 테스트 학생뿐인 반은 명단이 비어 대상이 아니다.
    if (input.excluded?.has(e.student_id)) continue;
    expected.add(e.student_id);
  }
  return { expected: expected.size, unrecorded: [...expected].some((id) => !input.recorded.has(id)) };
}
