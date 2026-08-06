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
  | "student_attendance_notice";

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
};
