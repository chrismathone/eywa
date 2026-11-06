/**
 * 슬랙 **활동 피드** 분류·등급 — 감사로그 액션 키(`AUDIT_ACTIONS`, 350여 종)를 화면용 분류와 발송 등급으로 나눈다.
 * 서버·클라 공용 순수 모듈(라벨은 서버가 `AUDIT_ACTIONS`에서 붙여 내려준다 — log.ts는 server-only).
 *
 * 등급(codex·grok 합의 2026-09-28 — **허용된 것만 나간다**):
 *  · forbid = 규칙에서 **고를 수 없다**. 급여·명세서·이력서·근로계약·비밀번호·토큰처럼 "누가 무엇을 했다"만으로도 인사·비밀 정보.
 *  · opaque = 라벨 + 행위자만. 대상(target_label)도 안 싣는다(금액·계좌가 대상 문구에 섞일 수 있는 돈 계열).
 *  · safe   = 라벨 + 대상 + 행위자.
 * 🔴 감사로그 **metadata(상세)는 통째로 싣지 않는다** — 액션마다 모양이 달라 민감값이 어디 섞일지 모른다. safe 등급만 허용 키
 *    (학생·반 → 확인된 이름 · 날짜·교시 · 출결 상태)를 [`activityFacts`](./activity-facts)가 바꿔 싣는다(원장 2026-09-28 '허용 항목만 풀기').
 * 🔴 분류 규칙에 안 걸린 키는 `null` → 가드 `activity-catalog.test.ts`가 실패한다(새 액션은 분류를 강제).
 */
export type ActivityGrade = "forbid" | "opaque" | "safe";
export type ActivityCategory = { id: string; label: string };

export const ACTIVITY_CATEGORIES: readonly ActivityCategory[] = [
  { id: "students", label: "원생·수강" },
  { id: "consult", label: "신규 콜&상담·학생상담" },
  { id: "attendance", label: "출결·보강·자리" },
  { id: "billing", label: "청구·수납·지출" },
  { id: "payroll", label: "급여" },
  { id: "classes", label: "반·시간표·강의실" },
  { id: "reports", label: "보고서·학부모 발송" },
  { id: "sheets", label: "강사 시트·교재·성적" },
  { id: "staff", label: "직원·결재·연차" },
  { id: "comms", label: "일정·공지·회의·도움말" },
  { id: "ops", label: "셔틀·재고" },
  { id: "settings", label: "설정·연동" },
];

/** 위에서부터 **처음 맞는 규칙**이 이긴다 — 좁은 접두어를 넓은 것보다 먼저. 문자열 끝 `_`가 없으면 정확히 그 키. */
const RULES: readonly [string, string][] = [
  ["student_consultation_", "consult"],
  ["student_care_analysis", "consult"],
  // 상담 약속·인계(s2_0028) — 학부모 요구에 대한 약속이라 상담 묶음.
  ["student_care_save", "consult"],
  ["student_ijw_", "settings"],
  ["enrollment_consultation_", "consult"],
  ["consultation_", "consult"],
  ["intake_token_", "consult"],
  ["intake_push_enqueue", "settings"],
  ["student_", "students"],
  // 반미정 영상 반 정리(운영 스크립트 · 2026-10-29) — 숙제 영상 일이라 보고서 묶음. 슬랙으로는 안 흘린다(FORBID_KEYS).
  ["video_unknown_class_fix", "reports"],
  ["enrollment_", "students"],
  ["newcomer_", "students"],
  ["withdrawal_", "students"],
  ["retention_", "students"],
  ["makeup_remove", "attendance"],
  ["ecs_attendance_clear", "attendance"],
  ["ecs_attendance_mark", "attendance"],
  ["seat_jj_", "sheets"],
  ["attendance_", "attendance"],
  ["makeup_", "attendance"],
  ["seat_", "attendance"],
  ["payroll_", "payroll"],
  ["payslip_", "payroll"],
  ["class_salary_update", "payroll"],
  ["session_splits_save", "payroll"],
  ["session_term_", "billing"],
  ["session_terms_refresh", "billing"],
  ["invoice_", "billing"],
  ["makeedu_paid_recovery", "billing"],
  ["expense_", "billing"],
  ["refund_request_", "billing"],
  ["tuition_", "billing"],
  ["class_review_", "staff"],
  // 직원 포트폴리오 집계(달 마감) — 기록에는 강사 수·마감한 달만 있고 점수는 없다.
  ["teacher_portfolio_", "staff"],
  ["teacher_evaluation_", "staff"],
  // 강사 급여 정책(누구만 남는다) — 급여 분류라 고를 수 없다.
  ["teacher_comp_", "payroll"],
  ["class_sheet_", "sheets"],
  ["class_", "classes"],
  ["classroom_", "classes"],
  ["timetable_", "classes"],
  ["operating_periods_save", "classes"],
  ["lesson_report_", "reports"],
  ["report_", "reports"],
  ["share_link_", "reports"],
  ["classnote_", "reports"],
  ["textbook_notice_send", "reports"],
  ["ecs_", "sheets"],
  ["mcs_", "sheets"],
  ["progress_", "sheets"],
  ["textbook_", "sheets"],
  // 수학 강사 시트(MCS) — 학생별 교재 배정 · 목표 교재 · 학교별 내신기간(대상 = 반 이름).
  ["math_textbook_assign", "sheets"],
  ["math_book_target", "sheets"],
  ["school_exam_periods", "sheets"],
  ["exam_", "sheets"],
  ["staff_", "staff"],
  ["approval_", "staff"],
  // 업무 요청(s2_0018) — 요청 → 보고 → 검토. 아직 미리보기 단계라 슬랙으로는 안 흘린다(FORBID_KEYS · SQL 머리말 약속).
  ["work_request_", "staff"],
  ["leave_", "staff"],
  ["self_", "staff"],
  ["resume_", "staff"],
  ["teacher_view_", "settings"],
  ["calendar_google_import", "settings"],
  ["calendar_google_push_sync", "settings"],
  ["calendar_", "comms"],
  ["announcement_", "comms"],
  ["meeting_", "comms"],
  // 녹음 중단 진단(2026-10-29) — 회의·상담 녹음 공용. 슬랙으로는 안 흘린다(FORBID_KEYS · 감사로그 화면에서 분석).
  ["recording_interrupted", "comms"],
  ["notice_popup_", "comms"],
  ["help_", "comms"],
  ["support_", "comms"],
  ["document_", "comms"],
  ["notion_", "comms"],
  ["briefing_", "comms"],
  // 운영실 업무 비서 'AI로 정리'(사람이 누른 유료 AI) — 감사로그 화면에서만(FORBID_KEYS).
  ["dashboard_secretary_", "comms"],
  ["shuttle_", "ops"],
  ["parent_account_", "ops"], // 학부모 계정 발급·삭제(셔틀 학부모 등하원)
  ["inventory_", "ops"],
  ["owner_", "settings"],
  ["integration_", "settings"],
  // 오늘 수학 지점 사용 메뉴(연결 앱) — 에이와에서 바꾼 것과 오늘 수학에서 알려 온 것이 같은 키.
  ["todays_math_", "settings"],
  ["slack_", "settings"],
  ["kiosk_", "settings"],
  ["kakao_", "settings"],
  ["ai_prompt_", "settings"],
  ["ment_style_", "settings"],
  ["sheets_sync_now", "settings"],
  ["sync_agent_", "settings"],
  ["ijw_", "settings"],
  // 원스크린 일괄 입력(맨 위 행 복사 · 직접 입력) — 보고서 칸을 채우는 동작.
  ["onescreen_", "reports"],
  ["data_export_", "settings"],
  ["demo_", "settings"],
  // 공용 엑셀 가져오기 한 번 = 한 줄(무엇을·몇 줄). 행별 기록(excelImport 표식)은 발송기가 건너뛴다.
  ["excel_import", "settings"],
];

/** 고를 수 없는 액션 — 분류 통째(급여) + 개별 키. */
const FORBID_CATEGORIES = new Set(["payroll"]);
const FORBID_PREFIXES = ["resume_", "staff_resume_", "staff_contract_", "staff_create_from_resume", "staff_link_from_resume", "slack_connection_token"];
const FORBID_KEYS = new Set([
  "student_contribution_refresh", "student_contribution_settings_save", "student_contribution_signal_cancel",
  "student_contribution_signal_rejudge", "student_contribution_referral_backfill", "student_contribution_referral_link",
  "student_contribution_summary_generate",
  // 운영 스크립트 정리 기록 — 슬랙으로 흘리지 않는다(감사로그 화면에서만).
  "student_history_rebuild", "video_unknown_class_fix",
  "recording_interrupted",
  "staff_password_reset",
  "self_password_change",
  "self_email_change",
  "staff_email_change",
  "kakao_channel_save",
  "kiosk_device_register",
  "staff_roster_import",
  "staff_roster_import_revert",
  // 누가 어떤 파일을 받았는지는 개인정보 접속기록이라 채널로 흘리지 않는다(보안 감사 2026-09-29).
  "data_export_download",
  // 연습본은 작성자 본인만 읽는 개인 사본이다 — 이름을 채널로 흘리지 않는다(운영 시간표 변경으로 읽힐 수도 있다).
  "timetable_lab_draft_save",
  "timetable_lab_draft_overwrite",
  "timetable_lab_draft_delete",
  // 메모 시트는 자동 저장이라(고칠 때마다) 채널로 내보내면 줄이 쏟아진다 — 고를 수 없게 둔다.
  "timetable_memo_sheet_save",
  // 칸 메모도 자동 저장이다(입력하는 대로) — 같은 이유로 고를 수 없게 둔다.
  "timetable_cell_memo_add",
  "timetable_cell_memo_update",
  "timetable_cell_memo_delete",
  // 업무 요청 · 업무 비서 — 슬랙과 잇지 않는다(업무 요청 SQL 머리말 · 미리보기 단계).
  "work_request_create",
  "work_request_act",
  "dashboard_secretary_run",
]);
/** 대상 문구 없이 — 돈 계열(금액·계좌가 대상 라벨에 섞일 수 있다) + 연차. */
const OPAQUE_CATEGORIES = new Set(["billing"]);
const OPAQUE_PREFIXES = ["leave_", "staff_leave_"];

export function activityCategoryOf(action: string): string | null {
  for (const [rule, cat] of RULES) {
    if (rule.endsWith("_") ? action.startsWith(rule) : action === rule || action.startsWith(`${rule}_`)) return cat;
  }
  return null;
}

export function activityGradeOf(action: string): ActivityGrade {
  const cat = activityCategoryOf(action);
  if (!cat) return "forbid"; // 분류 안 된 새 액션은 나가지 않는다(가드가 분류를 강제)
  if (FORBID_CATEGORIES.has(cat) || FORBID_KEYS.has(action) || FORBID_PREFIXES.some((p) => action.startsWith(p))) {
    return "forbid";
  }
  if (OPAQUE_CATEGORIES.has(cat) || OPAQUE_PREFIXES.some((p) => action.startsWith(p))) return "opaque";
  return "safe";
}

export type ActivityOption = { key: string; label: string; category: string; grade: ActivityGrade };

/** 서버가 `AUDIT_ACTIONS`(키→라벨)로 만든다. 순서 = 분류 순 → 원래 등록 순. */
export function buildActivityOptions(labels: Readonly<Record<string, string>>): ActivityOption[] {
  const order = new Map(ACTIVITY_CATEGORIES.map((c, i) => [c.id, i]));
  return Object.entries(labels)
    .map(([key, label]) => ({ key, label, category: activityCategoryOf(key) ?? "", grade: activityGradeOf(key) }))
    .filter((o) => o.category)
    .sort((a, b) => (order.get(a.category) ?? 99) - (order.get(b.category) ?? 99));
}
