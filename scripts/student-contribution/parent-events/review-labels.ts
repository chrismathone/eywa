/** Owner-facing labels; unknown parser reasons remain visible for diagnosis. */
export const REVIEW_REASON_LABELS: Record<string, string> = {
  absence_meaning_unconfirmed: "불참 표시 의미 확인", ambiguous_student: "동명이인 구분 필요", attendance_marker_unknown: "참석 표시 의미 확인",
  cancellation_ambiguous: "취소 여부 확인", cancellation_context_unconfirmed: "메모의 취소·불참·일정 변경 확인", confirmation_marker_unknown: "확인 칸 의미 확인",
  event_series_repeat: "같은 설명회의 다른 날짜 신청 중복 확인",
  cross_source_absence: "다른 명단의 불참 표시와 충돌", event_date_conflict: "행사일 충돌", event_date_conflict_27_vs_28: "7월 27일·28일 충돌",
  event_date_conflict_may_vs_march: "5월·3월 표제 충돌", event_date_invalid: "행사일 확인 필요", event_identity_unconfirmed: "같은 날 행사 구분 필요",
  event_kind_roundtable: "간담회 인정 범위 확인", event_missing: "행사 식별 필요", grade_conflict: "학년 불일치", grade_unstructured: "학년 표기 확인",
  guardian_conflict: "보호자 불일치", guardian_missing: "보호자 이름 부족", household_conflict: "가족 관계 충돌", household_partition_conflict: "가족 범위 중첩",
  name_phone_conflict: "이름·연락처 불일치", phone_missing: "연락처 없음", phone_invalid: "연락처 형식 확인", phone_unstructured: "연락처 전체 확인 필요",
  registration_status_conflict: "다른 신청과 취소 상태 충돌", row_identity_unconfirmed: "신청 행 구분 필요", school_conflict: "학교 불일치",
  school_date_unknown: "학교·학년 기준일 확인", school_grade_unstructured: "학교·학년 표기 확인", session_missing: "회차 없음", session_unmapped: "회차 구분 확인",
  source_identity_collision: "같은 신청의 원문 충돌", student_name_unstructured: "학생명 구분 필요", student_not_found: "학생 후보 없음",
  tenant_unknown: "지점 확인 필요", shared_phone: "공용·자리 채움 번호 확인", source_missing: "원본 위치 없음",
};
