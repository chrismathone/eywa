/**
 * 잘못 만든 **수업 이력(enrollments 행) 삭제**가 가능한가 — 판정의 단일 소스(순수).
 *
 * 원장 2026-08-20: *"이런 잘못된 수업 이력을 지우고 싶은데 마스터 및 원장에게 권한부여"* →
 * *"지우는건 안되네 이미 추가된 기록에 대해"* → *"대신 감사 로그에는 남겨"*.
 * (스크린샷 = 학생 상세 '지난 수업'의 `고등M 중2 PS3A · 2026-08-19 ~ 2026-08-19` — 시작=종료
 * zero-length, 사실상 배정 취소인 행. 같은 모양이 58건 있다.)
 *
 * ## 왜 "기록이 있으면 못 지운다"인가
 * `enrollments`를 참조하는 **FK는 0개**이고 `enrollment_id` 컬럼을 가진 표도 **0개**다 — 행을 지워도
 * 참조 무결성은 안 깨진다. 대신 출결·수업보고서·시수·청구는 전부 **(student_id, class_id) 논리적 연결**로
 * 남아 있어서, 수강만 지우면 **주인 없는 기록**이 된다(그 학생이 그 반에 있었다는 근거가 사라진다).
 *
 * ## 세는 표 — 코드에서 직접 확인한 목록(짐작 아님)
 * `student_id`와 `class_id`를 **둘 다** 가진 표 전수(schema.ts + supabase/migrations 스캔):
 *   · `attendance_records`(출결)            · `lesson_reports`(수업보고서, `class_id`=0134a·`makeup_class_id`=0171a)
 *   · `onescreen_daily_sessions`(수업타임=시수) · `class_sheet_student_marks`(영어 시트 기록, 0157a)
 *   · `attendance_followups`(후속조치, 0210a)
 * 청구 계열은 학생과 반이 **다른 표에 나뉘어** 있다 — `invoices.student_id` × `invoice_session_terms.class_id`
 * / `invoice_teacher_splits.class_id`(둘 다 `invoice_id`로만 학생에 닿는다) → 호출부가 invoice id를 거쳐 센다.
 * (`class_schedules`·`class_delegations`·`class_salary_settings` 등은 **반 단위**라 학생과 무관 — 제외.)
 *
 * ## 🔴 같은 반 재등록(형제 수강)을 어떻게 판단했나
 * 기록은 **enrollment가 아니라 (학생, 반)에 매여 있다.** 그러니 같은 (학생, 반)에 **다른 수강 행이 남는다면**
 * 이 행을 지워도 기록은 여전히 주인이 있다(출결·시수·급여 집계는 전부 (학생, 반) 축이라 숫자도 안 변한다).
 * → **형제 수강이 있으면 기록 수와 무관하게 삭제 허용.** 이렇게 안 하면 "옛 수강의 기록"을 이유로 어제 잘못
 * 만든 행을 영영 못 지운다(브리핑이 지적한 바로 그 상황).
 * 반대로 형제가 없으면 이 행이 **유일한 근거**라 기록이 1건이라도 있으면 거절한다 —
 * 대안(`수강 종료`)이 항상 한 클릭 거리에 있으므로 막는 쪽이 안전하다.
 *
 * ⚠️ 기간(start~end) 안 기록만 보면 놓친다(zero-length 행은 하루뿐인데 보고서는 다음 날 쓰이기도 한다) →
 *    **그 (학생, 반) 조합 전체**로 센다. 날짜 필터 없음.
 */

export type EnrollmentRecordCounts = {
  attendance: number;
  lessonReports: number;
  onescreenSessions: number;
  sheetMarks: number;
  followups: number;
  billing: number;
};

/** 화면 문구용 한글 라벨 — raw 표 이름을 노출하지 않는다. */
export const ENROLLMENT_RECORD_LABEL: Record<keyof EnrollmentRecordCounts, string> = {
  attendance: "출결",
  lessonReports: "수업보고서",
  onescreenSessions: "수업타임(시수)",
  sheetMarks: "영어 시트 기록",
  followups: "후속조치",
  billing: "청구·회차",
};

/** 표시 순서 — 중요한 것부터(문구가 길어지면 앞의 3종만 적는다). */
const ORDER: (keyof EnrollmentRecordCounts)[] = [
  "attendance",
  "lessonReports",
  "onescreenSessions",
  "billing",
  "sheetMarks",
  "followups",
];

export const EMPTY_RECORD_COUNTS: EnrollmentRecordCounts = {
  attendance: 0,
  lessonReports: 0,
  onescreenSessions: 0,
  sheetMarks: 0,
  followups: 0,
  billing: 0,
};

/**
 * 지울 수 없으면 **한글 이유**(무엇이 몇 건인지 + 대안), 지울 수 있으면 null.
 *
 * @param hasSiblingEnrollment 같은 (학생, 반)에 **이 행 말고** 다른 수강 행이 남는가.
 */
export function enrollmentDeleteBlockReason(input: {
  counts: EnrollmentRecordCounts;
  hasSiblingEnrollment: boolean;
}): string | null {
  // 형제 수강이 남으면 기록은 그쪽이 주인 — 지워도 주인 없는 기록이 생기지 않는다(위 주석 참조).
  if (input.hasSiblingEnrollment) return null;

  const present = ORDER.filter((k) => (input.counts[k] ?? 0) > 0);
  if (present.length === 0) return null;

  const shown = present.slice(0, 3);
  const parts = shown.map((k) => `${ENROLLMENT_RECORD_LABEL[k]} ${input.counts[k]}건`);
  const more = present.length - shown.length;
  const list = parts.join(" · ") + (more > 0 ? ` 외 ${more}종` : "");
  return (
    `${list}이 남아 있어 지울 수 없습니다 — 기록이 주인을 잃으면 시수·급여·청구가 어긋납니다. ` +
    `대신 '수강 종료'로 닫아 주세요.`
  );
}

/** 세어 본 결과를 한 줄 요약으로(감사로그·확인창 보조). 기록이 없으면 null. */
export function summarizeRecordCounts(counts: EnrollmentRecordCounts): string | null {
  const present = ORDER.filter((k) => (counts[k] ?? 0) > 0);
  if (present.length === 0) return null;
  return present.map((k) => `${ENROLLMENT_RECORD_LABEL[k]} ${counts[k]}건`).join(" · ");
}
