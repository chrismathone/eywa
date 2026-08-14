import type { EywaIconName } from "@/components/icons/eywa-icons";

// 알림 공용 타입/상수 — server-only 없음(클라 벨 컴포넌트도 import). 하드코딩 라벨은 여기 한 곳.

export type NotificationType =
  | "enrollment_assigned" // 내 반에 학생 배정
  | "enrollment_transferred_in" // 반이동으로 내 반에 전입
  | "teacher_handover" // 강사 인수인계로 내가 새 담임 지정
  | "classnote_parent_post" // 학부모가 ClassNote에 새 글 → 그 학생 담당 강사(연동 PC 워커가 insert)
  | "classnote_parent_comment" // 학부모가 ClassNote 알림장에 댓글 → 그 학생 담당 강사(위와 같은 워커)
  | "daily_briefing" // 일일 운영 브리핑 준비됨 → master만(그날 최초 생성 시 1회, cron이 insert)
  | "absence_alert" // 학생이 반복 결석 마일스톤(14일 3/5/10회) 도달 → master(Phase 3, cron)
  | "followup_due" // 상담 후속조치 기한 당일/지남 → 담당 상담사 폴백 master(Phase 3, cron)
  | "grade_drop" // 같은 과목 성적 15점+ 급락 → master + 담당 강사(Phase 3, cron)
  | "outstanding_alert" // 학생 총 미수 금액 tier 도달 → master + 회계(Phase 3, cron)
  | "unsent_report" // 저장만 하고 발송 안 한 수업 보고서(발송 콘솔과 동일 게이트) → master + 담당 강사(Phase 3, cron)
  | "progress_anomaly" // 진도 기록 이상(점프·겹침, math ingest) → master + 담당 강사(G2 선알림, cron)
  | "attendance_complete" // 반 출석 전원 입력 완료 → 담당 강사(G4, 저장 액션 전이 훅 — 본인이 찍으면 스킵)
  | "report_send_failed" // 수업 보고서 ClassNote 발송 최종 실패 → 담당 강사 폴백 master(0143a, DB 트리거)
  | "notice_send_failed" // 학부모 공지 게시 실패/일부실패 → 담당 강사(자기 학생) + 발송자(0144a, DB 트리거)
  | "makeedu_login_failed" // makeedu 접속(로그인) 실패 → master(연동 PC 헬스체크 check-session.mjs, 하루 1회)
  | "class_delegation" // 결근 대체로 반을 임시 위임받음 → 대체 강사(0173a, createClassDelegation)
  // 학부모의 결석·지각·조퇴 연락(클래스노트) → **직원 설정에서 토글을 켠 계정 전원**(0184a).
  // ⚠️ 담당 반과 무관하다 — 차량(셔틀)·사무실이 "오늘 누가 안 오는지"를 담임에게 묻지 않게 하는 게 목적.
  | "student_attendance_notice"
  // 강사가 결석을 입력한 순간 → 출결 알림 토글(users.attendance_alert_optin)을 켠 계정(2026-08-14).
  // ⚠️ 학부모 연락 분류(student_attendance_notice)와 **다른 축**이다: 저건 학부모가 먼저 알려온 것이고,
  //    이건 학원이 먼저 알아챈 것이라 확인 전화가 필요하다. 링크는 데스크 확인 큐.
  | "attendance_absent_desk"
  // 사무실이 "이 교시 출결 입력해 주세요"를 담당 강사(슬롯 담당 포함)에게 요청 — 데스크 레인 A 버튼.
  // ⚠️ 이게 없으면 데스크는 헛전화 아니면 방치뿐이었다(적대 리뷰 S4). dedup은 (반, 날짜|교시) 1회.
  | "attendance_input_request"
  // 미출결 → 출결. 데스크가 찍으면 강사에게, 강사가 찍으면 데스크(optin)에게(0212a).
  | "attendance_unmarked_to_present"
  // 휴가(연차) 전자결재 — 신청이 올라가면 결재선 전원에게, 결재가 끝나면 신청자에게(0210a).
  | "leave_request_submitted"
  | "leave_request_decided";

export type NotificationItem = {
  id: string;
  type: NotificationType | string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  createdAt: string;
};

/** 유형별 Eywa 아이콘. 미등록 유형은 벨 컴포넌트에서 기본 bell. */
export const NOTIFICATION_ICON: Record<string, EywaIconName> = {
  enrollment_assigned: "book",
  enrollment_transferred_in: "swap",
  teacher_handover: "userCheck",
  classnote_parent_post: "message",
  classnote_parent_comment: "message",
  daily_briefing: "sparkle",
  absence_alert: "userMinus",
  followup_due: "clock",
  grade_drop: "trendingDown",
  outstanding_alert: "wallet",
  unsent_report: "send",
  progress_anomaly: "alert",
  attendance_complete: "userCheck",
  report_send_failed: "alert",
  notice_send_failed: "alert",
  makeedu_login_failed: "alert",
  student_attendance_notice: "userMinus",
  attendance_absent_desk: "userMinus",
  attendance_input_request: "clipboardCheck",
  attendance_unmarked_to_present: "userCheck",
  leave_request_submitted: "calendarOff",
  leave_request_decided: "calendarCheck",
};
