import type { AywaIconName } from "@/components/icons/aywa-icons";

// 알림 공용 타입/상수 — server-only 없음(클라 벨 컴포넌트도 import). 하드코딩 라벨은 여기 한 곳.

/**
 * 벨 목록 크기 — 기본 20, '더 보기'로 20씩 늘려 최대 100(읽음 처리 id 상한과 같다, F17 2026-09-23).
 * 배지(안 읽음 수)는 전체를 세는데 목록은 잘려 있어서, '모두 읽음'이 보지도 못한 알림을 치우던 것을 막는다.
 */
export const NOTIFICATION_LIST_LIMIT = 20;
export const NOTIFICATION_LIST_MAX = 100;

export type NotificationType =
  | "enrollment_assigned" // 내 반에 학생 배정
  | "enrollment_transferred_in" // 반이동으로 내 반에 전입
  | "teacher_handover" // 강사 인수인계로 내가 새 담임 지정
  | "classnote_parent_post" // 학부모가 ClassNote에 새 글 → 그 학생 담당 강사(연동 PC 워커가 insert)
  | "classnote_parent_comment" // 학부모가 ClassNote 알림장에 댓글 → 그 학생 담당 강사(위와 같은 워커)
  | "daily_briefing" // 과거 저장 데이터 호환용. 생성 중단, 벨 목록·미확인 수에서 제외.
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
  // 역방향(2026-08-18 원장): 강사가 "미입력 학생을 데스크에서 확인해 주세요"를 요청 — 강사 홈 스트립 버튼.
  // 수신 = 출결 알림 토글(users.desk_attendance_optin) 켠 계정. dedup은 (반, 날짜|저장축 교시) 1회.
  | "attendance_desk_confirm_request"
  // 미출결 → 출결. 데스크가 찍으면 강사에게, 강사가 찍으면 데스크(optin)에게.
  | "attendance_unmarked_to_present"
  // 데스크가 학부모 결석 통보를 **접수**해 미리 결석으로 입력함 → 그 반 담임·부담임(2026-08-19).
  // ⚠️ `attendance_absent_desk`와 방향이 반대다(저건 강사→데스크). 이건 **미래 날짜가 본체**라
  //    "이미 처리됐으니 따로 하실 것 없다"를 알려 담임의 이중 처리를 막는 것이 목적이다.
  | "attendance_absence_intake"
  // 전자결재(0212a) — **내 결재 차례가 됐을 때** 그 결재자에게(순차라 한 명씩), 문서가 끝나면 기안자에게.
  | "approval_requested"
  | "approval_decided"
  // 결재 문서에 댓글(0227a) — 기안자·결재선에게(작성자 제외). 전결 사유 등 공유가 목적이라 참조는 제외.
  | "approval_comment"
  | "help_question"
  | "help_answer";

export type NotificationItem = {
  id: string;
  type: NotificationType | string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  createdAt: string;
};

/** 유형별 Aywa 아이콘. 미등록 유형은 벨 컴포넌트에서 기본 bell. */
export const NOTIFICATION_ICON: Record<string, AywaIconName> = {
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
  attendance_desk_confirm_request: "clipboardCheck",
  attendance_unmarked_to_present: "userCheck",
  attendance_absence_intake: "userMinus",
  approval_requested: "scrollText",
  approval_decided: "clipboardCheck",
  approval_comment: "message",
  help_question: "help",
  help_answer: "help",
};
