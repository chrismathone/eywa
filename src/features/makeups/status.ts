export const MAKEUP_REASON: Record<string, string> = {
  absence: "결석", planned_absence: "예정 결석", class_cancelled: "휴강",
  additional: "추가 지도", imported: "기존 약속",
};
export const MAKEUP_STATE: Record<string, string> = {
  pending: "승인 대기", approved: "승인됨", denied: "자격 거절", open: "진행 중",
  on_hold: "보류", closed: "종결", unknown: "참여 미입력", present: "참여",
  partial: "부분 참여", no_show: "불참", cancelled: "취소", confirmed: "예약 확정",
  finished: "실시 기록", rescheduled: "변경됨", draft: "기록 초안", submitted: "검토 대기",
  returned: "보완 요청", verified: "인정됨", reversed: "인정 정정", done: "반영됨", failed: "반영 실패",
};
export const MAKEUP_FLAG: Record<string, string> = {
  active: "미처리", pending: "승인 대기", unassigned: "담당 미지정", unscheduled: "예약 필요",
  due_soon: "기한 임박", overdue: "기한 경과", record_missing: "실시 기록 필요",
  review_pending: "검토 대기", recon_open: "대사 필요", hold_review_due: "보류 재검토",
};
export const MAKEUP_ACTION: Record<string, string> = {
  intake: "접수", approve: "승인", deny: "자격 거절", assign: "담당·기한 지정", reserve: "예약",
  reschedule: "일정 변경", cancel: "예약 취소", participation: "참여 기록", submit: "검토 제출",
  verify: "실시 인정", reverse: "인정 정정", waive: "분량 면제", adjust: "분량·기한 조정",
  hold: "보류", resume: "재개", close: "종결", link_legacy: "기존 약속 연결",
  resolve_reconciliation: "대사 처리", reconcile: "대사 실행", configure: "운영 설정", review: "검토", record: "기록",
  none: "업무 없음", review_hold: "보류 재검토", review_eligibility: "승인 검토",
  assign_owner: "담당 지정", schedule: "예약", await_session: "예약 실시 대기",
};
export const MAKEUP_RECON: Record<string, string> = {
  source_conflict: "원출결 정정 확인", units_review: "시수 확인", units_mismatch: "수기 시수 차이",
  timetable_conflict: "일정 충돌", evidence_removed: "실시 근거 변경", owner_inactive: "담당 인계 필요",
  teacher_inactive: "실시강사 변경 필요", anchor_missing: "출결 반 확인", legacy_done_review: "기존 완료 근거 확인",
  legacy_multi_same_day: "당일 약속 중복 확인", legacy_checksum_conflict: "기존 약속 변경 확인",
  attendance_observed: "출결 연결 확인",
  billing_review: "수납 회차 소비 확인", handover_review: "담당 인계 확인", quantity_drift: "분량 원장 대사",
};
export const MAKEUP_EVENT: Record<string, string> = {
  ...MAKEUP_ACTION, source_added: "접수 근거 연결", approved: "분량 승인", denied: "자격 거절",
  assigned: "담당·기한 지정", participant_cancelled: "학생 예약 취소", participant_released: "예약 점유 해제",
  session_cancelled: "회차 취소", session_rescheduled: "회차 일정 변경", participation_recorded: "실제 참여 기록",
  fulfillment_submitted: "검토 제출", fulfillment_returned: "보완 요청", recognized: "분량 인정",
  recognition_reversed: "인정 정정", reopened: "진행 재개", waived: "분량 면제",
  quantity_adjusted: "분량 조정", due_date_changed: "기한 조정", held: "보류", resumed: "재개",
  closed: "종결", configured: "운영 설정", policy_created: "정책 승인", legacy_linked: "기존 약속 연결",
  projection_done: "기록 반영", projection_failed: "반영 실패", reconciliation_resolved: "대사 처리",
  reconciliation_dismissed: "대사 제외",
};
export const MAKEUP_CLOSURE: Record<string, string> = {
  completed: "실시 완료", completed_with_waiver: "실시·면제 완료", waived: "전량 면제", duplicate: "중복 건 정리", source_retracted: "접수 근거 철회",
};
export const MAKEUP_EVIDENCE: Record<string, string> = {
  participation_missing: "참여와 실제 지도 근거를 입력해 주세요", participation_cancelled: "취소된 참여의 기록을 확인해 주세요",
  attendance_missing: "실시 날짜의 출결 기록을 연결해 주세요", attendance_other_cell: "학생·반·날짜가 같은 출결을 골라 주세요",
  attendance_superseded: "정정 후 최신 출결 기록을 확인해 주세요", attendance_other_slot: "보강 시간에 해당하는 출결을 확인해 주세요",
  attendance_not_countable: "실제 출결 상태를 확인해 주세요", attendance_other_teacher: "출결의 귀속 강사와 실제 지도 강사를 확인해 주세요",
  regular_teacher_differs: "정규 수업과 보강의 실제 담당 강사가 달라 확인이 필요합니다",
  units_mismatch: "저장 시수와 예상 시수가 다릅니다", units_unknown: "일부 참여의 실제 시수를 확인해 주세요",
  no_show_with_attendance: "불참으로 기록했지만 보강 시수가 남아 있습니다", anchor_missing: "출결·보고서 반을 지정해 주세요",
};
export const makeupText = (map: Record<string, string>, key: string) => map[key] ?? "확인 필요";
