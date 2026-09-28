/**
 * 샘플 알림용 **가상 데이터** — 종류마다 실제 알림과 같은 제목·본문 틀(각 notifyUsers 호출부의 문구)에 가짜 학생·반·직원을
 * 넣었다(원장 2026-09-28 *"실제로 나가는 알림처럼 보여줘 테스트 알림들은. 가상 데이터로"*).
 * 🔴 실제 문구를 바꾸면 여기 샘플도 함께(어긋나면 "샘플과 실제가 다르다"). 링크는 가짜 id 대신 **목록 화면**으로
 *    (가짜 id로 열면 404). 받는 사람도 가상 이름 — 실제 직원 이름을 샘플에 쓰지 않는다.
 */
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
  grade_drop: { title: "성적 급락", body: "박지우 학생 수학 성적이 18점 하락했습니다(현재 62점).", link: "/retention" },
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
    body: "학부모: \"내일 가족 행사가 있어 하루 쉽니다\" — 출결 확인이 필요합니다.",
    link: "/attendance/live?tab=desk",
  },
  classnote_parent_post: { title: "학부모 새 글 — 이서준", body: "이번 주 숙제 범위를 다시 알려주실 수 있을까요?", link: "/onescreen" },
  classnote_parent_comment: { title: "학부모 댓글 — 박지우", body: "알림장 확인했습니다. 감사합니다!", link: "/onescreen" },
  report_send_failed: { title: "수업 보고서 발송 실패", body: "김하늘 · 09-26 — 학부모 보드를 찾지 못했습니다", link: "/lesson-reports" },
  notice_send_failed: { title: "학부모 공지 게시 실패", body: "10월 휴원 안내 — 3명에게 게시하지 못했습니다", link: "/lesson-reports" },
  makeedu_login_failed: {
    title: "makeedu 접속이 실패했습니다",
    body: "makeedu 동기화가 멈춥니다 — 비밀번호 변경·CAPTCHA·계정 잠금을 확인해 주세요. (감지 2026-09-28)",
    link: "/owner?tab=sheets&sub=makeedu",
  },
  support_answer: { title: "개선요청에 답변이 달렸습니다", body: "출석부 인쇄 여백 조정 요청 — 처리 완료", link: "/help" },
  slack_broken: { title: "슬랙 발송이 멈췄습니다", body: "슬랙이 토큰을 거절했습니다 — 학원 설정 → 연동에서 새 봇 토큰을 저장해 주세요. 그동안의 알림은 쌓아 두었다가 이어서 보냅니다.", link: "/owner?tab=sheets" },
  help_question: { title: "도움말 새 질문", body: "보강 예약은 어디서 하나요?", link: "/help" },
  help_answer: { title: "도움말 질문에 답변이 달렸습니다", body: "보강 예약은 어디서 하나요?", link: "/help" },
};

export const SAMPLE_FOOTER = "_테스트 알림 · 가상 데이터_";
