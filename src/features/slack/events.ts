import type { NotificationType } from "@/features/notifications/types";

/**
 * 슬랙으로 보낼 수 있는 알림 종류 — `notifyUsers()`를 **거치는** 것만(2026-09-28 1단계).
 *
 * 🔴 여기 없는 알림은 `notifyUsers()`를 안 거치고 직접 insert된다 → 목록에 올리면 "골랐는데 안 온다"는
 *    거짓 약속이 된다(write-only-orphan). 빠진 것과 이유:
 *    · classnote_parent_post·classnote_parent_comment·makeedu_login_failed = 연동 PC 워커 스크립트가 insert
 *    · report_send_failed·notice_send_failed = DB 트리거(0143a·0144a) + failed-notify-sweep 직접 insert
 *    · student_attendance_notice = parent-alerts/classify.ts 직접 insert
 *    · daily_briefing = 생성 중단(과거 데이터 호환용)
 *    새 알림 종류를 notifyUsers로 만들면 여기에도 한 줄 더할 것(가드 `events.test.ts`).
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
  { type: "absence_alert", label: "반복 결석", group: "학생 관리" },
  { type: "followup_due", label: "상담 후속조치 기한", group: "학생 관리" },
  { type: "grade_drop", label: "성적 급락", group: "학생 관리" },
  { type: "outstanding_alert", label: "미납 누적", group: "학생 관리" },
  { type: "unsent_report", label: "미발송 수업 보고서", group: "학생 관리" },
  { type: "progress_anomaly", label: "진도 기록 이상", group: "학생 관리" },
  { type: "approval_requested", label: "결재 요청", group: "전자결재" },
  { type: "approval_decided", label: "결재 완료", group: "전자결재" },
  { type: "approval_comment", label: "결재 댓글", group: "전자결재" },
  { type: "help_question", label: "도움말 질문", group: "도움말" },
  { type: "help_answer", label: "도움말 답변", group: "도움말" },
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
