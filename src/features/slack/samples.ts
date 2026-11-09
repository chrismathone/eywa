/**
 * 샘플 알림용 **가상 데이터** — 종류마다 실제 알림과 같은 제목·본문 틀(각 notifyUsers 호출부의 문구)에 가짜 학생·반·직원을
 * 넣었다(원장 2026-09-28 *"실제로 나가는 알림처럼 보여줘 테스트 알림들은. 가상 데이터로"*).
 * 🔴 실제 문구를 바꾸면 여기 샘플도 함께(어긋나면 "샘플과 실제가 다르다"). 링크는 가짜 id 대신 **목록 화면**으로
 *    (가짜 id로 열면 404). 받는 사람도 가상 이름 — 실제 직원 이름을 샘플에 쓰지 않는다.
 */
import { heartbeatAlertText, HEARTBEAT_ALERT_LINK } from "@/features/sync-agent/heartbeat-alert";

export type SampleNotification = { title: string; body: string; link: string };

export const SAMPLE_RECIPIENTS = ["박지현"];

export const SAMPLE_NOTIFICATIONS: Record<string, SampleNotification> = {
  enrollment_assigned: { title: "새 학생 배정", body: "김하늘 외 1명 학생이 중2 수학 A 반에 배정되었습니다.", link: "/classes" },
  enrollment_transferred_in: { title: "반 이동 전입", body: "이서준 학생이 중3 영어 B 반에 전입되었습니다.", link: "/classes" },
  teacher_handover: { title: "강사 인수인계 예약", body: "중1 수학 C 반의 새 담임으로 예약되었습니다 (적용일 2026-10-01).", link: "/classes" },
  class_delegation: {
    title: "대신 맡을 수업이 생겼습니다",
    body: "중2 수학 A 반을 9/30(수) 하루 대신 맡습니다. 원스크린 반 목록의 '위임'에서 보입니다.",
    link: "/onescreen",
  },
  attendance_complete: {
    title: "출석 입력 완료",
    body: "중2 수학 A 반 출석이 모두 입력됐습니다 — 수업 보고서를 작성할 준비가 됐어요.",
    link: "/onescreen",
  },
  attendance_absent_desk: {
    title: "결석 — 김하늘",
    body: "2026-09-28 수업에서 김하늘 학생이 결석으로 입력됐습니다 — 학부모 확인이 필요합니다.",
    link: "/attendance/live?tab=desk",
  },
  attendance_input_request: {
    title: "출결 입력 요청 — 중2 수학 A 16:20",
    body: "데스크에서 오늘 출결 입력을 요청했습니다. 화면 위 '오늘 출석 미입력'에서 바로 찍을 수 있습니다.",
    link: "/attendance/live",
  },
  attendance_desk_confirm_request: {
    title: "데스크 확인 요청 — 중2 수학 A 16:20",
    body: "강사가 미입력 김하늘, 이서준 학생의 등원 확인을 요청했습니다.",
    link: "/attendance/live?tab=desk",
  },
  attendance_unmarked_to_present: {
    title: "데스크가 출석 처리 — 이서준",
    body: "2026-09-28 미출결이던 이서준 학생을 데스크에서 출석으로 입력했습니다.",
    link: "/attendance/live",
  },
  attendance_absence_intake: {
    title: "박지우 결석 접수 · 9/30",
    body: "중3 영어 B · 가족 행사 · 데스크가 학부모 연락을 받아 출석부에 결석으로 입력했습니다 — 따로 처리하실 것 없습니다.",
    link: "/attendance",
  },
  absence_alert: {
    title: "반복 결석 학생",
    body: "김하늘 학생 · 최근 14일 결석 3회. 출결을 확인해 주세요.",
    link: "/dashboard#repeated-absences",
  },
  followup_due: {
    title: "오늘 마감 상담 후속조치",
    body: "이서준 학생 상담 후속조치가 오늘(2026-09-28) 마감 예정입니다.",
    link: "/consultations",
  },
  enrollment_followup: {
    title: "오늘 콜&상담 후속 조치",
    body: "최유나 다음 상담이 오늘(9월 28일)입니다 · 메모: 겨울방학 특강 시간표 안내",
    link: "/enrollment",
  },
  grade_drop: { title: "성적 급락", body: "박지우 학생 수학 성적이 18점 하락했습니다(현재 62점).", link: "/retention" },
  refund_request_cancelled: { title: "퇴원이 취소되었습니다 — 환불 진행 전 확인", body: "김하늘 · 퇴원보고서 요청이 취소되었습니다. 환불 요청서는 그대로 남아 있으니 환불을 진행하기 전에 확인해 주세요.", link: "/billing?tab=refunds" },
  refund_request_approved: { title: "김하늘 환불 처리 — 퇴원보고서 환불 승인", body: "2026-11 청구 710,000원 · 퇴원 2026-10-28 · 환불 처리를 진행해 주세요.", link: "/billing?tab=refunds" },
  outstanding_alert: { title: "미수금 주의 학생", body: "김하늘 학생의 미수금이 60만원에 이릅니다.", link: "/billing?overdue=1" },
  unsent_report: {
    title: "미발송 수업 보고서",
    body: "이서준 학생 2026-09-26 수학 수업 보고서가 저장만 되고 아직 발송되지 않았습니다.",
    link: "/lesson-reports?tab=list",
  },
  progress_anomaly: {
    title: "진도 기록 이상",
    body: "박지우 학생 수학 진도 기록에 이상이 감지됐습니다(진도 점프) — 진도 탭에서 확인해 주세요.",
    link: "/students",
  },
  approval_requested: { title: "결재 요청", body: "박지현 · 10월 교재 구입 품의", link: "/approvals" },
  approval_decided: { title: "결재 승인", body: "10월 교재 구입 품의 — 승인되었습니다", link: "/approvals" },
  approval_comment: { title: "결재 문서 댓글", body: "10월 교재 구입 품의 — 박지현: 수량 한 번만 확인 부탁드려요", link: "/approvals" },
  student_attendance_notice: {
    title: "김하늘 결석 9/30",
    body: "가족 행사 · 중등M 중2 A 보드에 글 작성: “내일 가족 행사가 있어 하루 쉽니다”",
    link: "/attendance/live?tab=desk",
  },
  classnote_parent_post: { title: "학부모 새 글 — 이서준", body: "이번 주 숙제 범위를 다시 알려주실 수 있을까요?", link: "/onescreen" },
  classnote_parent_comment: { title: "학부모 댓글 — 박지우", body: "알림장 확인했습니다. 감사합니다!", link: "/onescreen" },
  homework_video_link: { title: "박지우 학생 숙제 영상이 제출 링크로 올라왔습니다", body: "중등M 중2 A", link: "/students" },
  video_homework_submitted: {
    title: "김하늘 학생의 영상 숙제가 제출됐습니다",
    body: "중등M 중2 A · 2026-09-26 숙제 · 2026-09-28 제출",
    link: "/onescreen/video-homework",
  },
  video_homework_missing: {
    title: "영상 숙제 미제출 2건",
    body: "제출 마감이 지난 영상 숙제입니다. 영상 제출 현황에서 확인해 주세요.",
    link: "/onescreen/video-homework?status=missing",
  },
  video_homework_unassigned: {
    title: "미배정 영상 1건이 있습니다",
    body: "영상 제출 현황에서 숙제를 연결해 주세요.",
    link: "/onescreen/video-homework",
  },
  homework_video_upload_failed: {
    title: "이서준 학생 영상 업로드 확인 필요",
    body: "중등M 중2 A · 제출 완료 전에 화면을 떠난 기록이 있습니다. · 확인번호 3f9a1c2e",
    link: "/students",
  },
  todays_math_exam_report: {
    title: "월말평가 성적표",
    body: "박지우 학생의 9/30 월말평가 성적표를 붙일 그날 수학 보고서가 없습니다. 보고서를 보내면 성적표가 함께 붙어 나갑니다.",
    link: "/onescreen",
  },
  report_send_failed: { title: "수업 보고서 발송 실패", body: "김하늘 · 09-26 — 학부모 보드를 찾지 못했습니다", link: "/lesson-reports" },
  notice_send_failed: { title: "학부모 공지 게시 실패", body: "10월 휴원 안내 — 3명에게 게시하지 못했습니다", link: "/lesson-reports" },
  // 실제 문구 = src/features/sync-agent/heartbeat-alert.ts heartbeatAlertText(같은 함수 — 11-06 사고 시각으로).
  sync_agent_offline: { ...heartbeatAlertText(new Date("2026-11-06T08:37:00Z"), new Date("2026-11-06T09:02:00Z")), link: HEARTBEAT_ALERT_LINK },
  // 실제 문구 = scripts/_makeedu/login-guard.cjs notificationTextFor(사람 확인 · 비밀번호 틀림 · 그 밖) — 견본은 가장 흔한 사람 확인.
  makeedu_login_failed: {
    title: "makeedu가 사람 확인을 요구합니다",
    body: "makeedu 자동 동기화가 멈췄습니다 — 동기화 PC의 AYWA 연동 앱에서 'makeedu 다시 로그인'을 눌러 확인 한 번 해 주세요. (감지 2026-11-06)",
    link: "/owner?tab=sheets&sub=makeedu",
  },
  support_answer: { title: "개선요청에 답변이 달렸습니다", body: "출석부 인쇄 여백 조정 요청 — 처리 완료", link: "/help" },
  staff_task_digest: { title: "늦은 할 일 3건", body: "보고서 발송 실패 2 · 상담 후속조치 1 — 김선생 2 · 이선생 1", link: "/dashboard" },
  withdrawal_bypass: {
    title: "퇴원보고서 없이 퇴원 처리됨",
    body: "김하늘 · 퇴원일 9월 28일 · 처리한 사람 박지현 — 퇴원보고서를 거치지 않았습니다. 확인해 주세요.",
    link: "/withdrawals",
  },
  slack_broken: { title: "슬랙 발송이 멈췄습니다", body: "슬랙이 토큰을 거절했습니다 — 학원 설정 → 연동에서 새 봇 토큰을 저장해 주세요. 그동안의 알림은 쌓아 두었다가 이어서 보냅니다.", link: "/owner?tab=sheets" },
  help_question: { title: "도움말 새 질문", body: "보강 예약은 어디서 하나요?", link: "/help" },
  help_answer: { title: "도움말 질문에 답변이 달렸습니다", body: "보강 예약은 어디서 하나요?", link: "/help" },
};

export const SAMPLE_FOOTER = "_테스트 알림 · 가상 데이터_";

/** 지출결의서(돈 계열) 미리보기·테스트 발송의 가상 기록 — 실제 발송처럼 `moneyFacts`를 지나게 한다. */
export const SAMPLE_EXPENSE_META = { amount: 125000, currency: "KRW", category: "운영비", expenseDate: "2026-09-28" };

/** 활동 미리보기·샘플의 가상 '누구의 무엇'(activity-facts 모양). */
export const SAMPLE_ACTIVITY_FACTS = {
  brief: ["김하늘", "중등M 중1 A", "9/28(월) 17:15"],
  rows: [
    { label: "학생", value: "김하늘 (칠성중1)" },
    { label: "반", value: "중등M 중1 A · 수학" },
    { label: "날짜", value: "9/28(월) 17:15 교시" },
  ],
  href: "/students",
};
