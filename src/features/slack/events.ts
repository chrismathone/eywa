import type { NotificationType } from "@/features/notifications/types";

/**
 * 슬랙으로 보낼 수 있는 **알림** 종류 — 알림 표(`notifications`)에 들어가는 전부(0298a 인박스 트리거가 같은 트랜잭션에서
 * 잡으므로 앱 `notifyUsers()`·DB 트리거·연동 PC 워커 insert가 모두 걸린다).
 * 빠진 것은 `daily_briefing` 하나 — 생성 중단된 과거 호환용이다.
 * 🔴 새 알림 종류를 만들면 여기에도 한 줄 + [`samples.ts`](./samples.ts)에 샘플(가드 `events.test.ts`).
 */
export type ForwardEventOption = { type: NotificationType; label: string; group: string };

export const FORWARD_EVENT_OPTIONS: readonly ForwardEventOption[] = [
  { type: "enrollment_assigned", label: "내 반에 학생 배정", group: "수업·반" },
  { type: "enrollment_transferred_in", label: "반이동 전입", group: "수업·반" },
  { type: "teacher_handover", label: "담임 인수인계", group: "수업·반" },
  { type: "class_delegation", label: "결근 대체 위임", group: "수업·반" },
  { type: "attendance_complete", label: "반 출석 입력 완료", group: "출결" },
  { type: "attendance_absent_desk", label: "강사 결석 입력(데스크 확인)", group: "출결" },
  { type: "attendance_input_request", label: "출결 입력 요청", group: "출결" },
  { type: "attendance_desk_confirm_request", label: "데스크 확인 요청", group: "출결" },
  { type: "attendance_unmarked_to_present", label: "미출결 → 출석 전환", group: "출결" },
  { type: "attendance_absence_intake", label: "결석 사전 접수", group: "출결" },
  // 학생이 가족 계정으로 직접 쓴 글도 들어온다(작성자 칸 없음 · 원장 2026-11-04) — '학부모'라고 적지 않는다.
  { type: "student_attendance_notice", label: "ClassNote 결석·지각 연락", group: "출결" },
  { type: "absence_alert", label: "반복 결석", group: "학생 관리" },
  { type: "followup_due", label: "상담 후속조치 기한", group: "학생 관리" },
  { type: "enrollment_followup", label: "콜&상담 후속 조치(다음 상담)", group: "학생 관리" },
  { type: "staff_task_digest", label: "늦은 할 일 요약(매일 아침)", group: "학생 관리" },
  { type: "grade_drop", label: "성적 급락", group: "학생 관리" },
  { type: "outstanding_alert", label: "미납 누적", group: "학생 관리" },
  { type: "refund_request_approved", label: "환불 승인(퇴원보고서)", group: "학생 관리" },
  { type: "unsent_report", label: "미발송 수업 보고서", group: "학생 관리" },
  { type: "progress_anomaly", label: "진도 기록 이상", group: "학생 관리" },
  { type: "withdrawal_bypass", label: "퇴원보고서 없이 퇴원", group: "학생 관리" },
  { type: "classnote_parent_post", label: "학부모 ClassNote 글", group: "학부모·발송" },
  { type: "classnote_parent_comment", label: "학부모 ClassNote 댓글", group: "학부모·발송" },
  { type: "homework_video_link", label: "제출 링크로 숙제 영상 올림", group: "학부모·발송" },
  { type: "video_homework_submitted", label: "영상 숙제 제출됨", group: "학부모·발송" },
  { type: "video_homework_missing", label: "영상 숙제 미제출(마감 지남)", group: "학부모·발송" },
  { type: "video_homework_unassigned", label: "숙제에 연결 안 된 영상", group: "학부모·발송" },
  { type: "homework_video_upload_failed", label: "숙제 영상 업로드 확인 필요", group: "학부모·발송" },
  { type: "todays_math_exam_report", label: "월말평가 성적표 첨부 못 함(오늘 수학)", group: "학부모·발송" },
  { type: "report_send_failed", label: "보고서 발송 실패", group: "학부모·발송" },
  { type: "notice_send_failed", label: "학부모 공지 게시 실패", group: "학부모·발송" },
  { type: "approval_requested", label: "결재 요청", group: "전자결재" },
  { type: "approval_decided", label: "결재 완료", group: "전자결재" },
  { type: "approval_comment", label: "결재 댓글", group: "전자결재" },
  { type: "help_question", label: "도움말 질문", group: "도움말·연동" },
  { type: "help_answer", label: "도움말 답변", group: "도움말·연동" },
  { type: "makeedu_login_failed", label: "makeedu 로그인 실패", group: "도움말·연동" },
  { type: "support_answer", label: "개선요청 답변", group: "도움말·연동" },
  { type: "slack_broken", label: "슬랙 발송 멈춤", group: "도움말·연동" },
];

const LABEL_BY_TYPE = new Map<string, string>(FORWARD_EVENT_OPTIONS.map((o) => [o.type, o.label]));

export function forwardEventLabel(type: string): string {
  return LABEL_BY_TYPE.get(type) ?? "알림";
}

/** 저장 전 정리 — 목록에 있는 종류만, 중복 없이, 목록 순서대로. */
export function sanitizeForwardEventTypes(input: readonly string[]): NotificationType[] {
  const picked = new Set(input);
  return FORWARD_EVENT_OPTIONS.filter((o) => picked.has(o.type)).map((o) => o.type);
}
