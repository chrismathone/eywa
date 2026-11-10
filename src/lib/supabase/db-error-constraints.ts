// DB 제약 이름 → 화면용 한글 이유(순수 데이터). 판정기는 [db-error.ts]의 `describeDbError`.
//
// 🔴 목록은 **운영 DB에서 SELECT로 확인한 제약 이름**이다(2026-10-01, pg_indexes·pg_constraint) — 추측으로 적지 말 것.
//    제약 이름이 바뀌면(마이그레이션) 이 표가 조용히 안 맞는다 → 코드별 기본 문구로 떨어진다. 이름 **규약**으로 고르는
//    CHECK 문구(아래 checkConstraintMessage)는 규약 밖 정의를 만나면 틀릴 수 있다 — 규약과 다른 CHECK는 이 표에 직접 적을 것.
// 🔴 문구는 **그 제약이 실제로 막는 것**만 말한다. 같은 표의 다른 유니크(예: 학생 자연키 ↔ 출결번호)를
//    한 문장으로 뭉치면 원인을 거꾸로 알려 준다(2026-10-01 이전 학생 저장이 그랬다 — 모든 23505를 "이름·학교·학년 중복"으로).
// ⚠️ 외래키(23503)는 **같은 제약 이름이 방향에 따라 뜻이 다르다** — 지울 때는 "다른 기록이 쓰고 있다",
//    넣을 때는 "연결할 대상이 없다". 그래서 FK 항목은 `op: "delete"`로 묶어 두고, 넣기에선 코드 기본 문구를 쓴다.

export type ConstraintMessage = {
  /** 화면에 그대로 보일 한글 문장. */
  message: string;
  /** 폼 칸 이름(그 칸 아래에 이유를 붙일 수 있을 때). 폼마다 키가 다르면 호출부가 덮어쓴다. */
  field?: string;
  /** 이 동작에서만 맞는 문구 — 외래키는 "delete". 지정하면 다른 동작에서는 쓰지 않는다. */
  op?: "write" | "delete";
};

const DIRECT: Record<string, ConstraintMessage> = {
  // s2_0042(2026-11-09, 운영 DB 적용 후 pg_constraint로 이름 확인) — 넣을 때 = 다른 지점 학생. 지울 때는 기존 학생 FK 문구·코드 기본 문구.
  invoices_tenant_student_fk: { message: "이 학원의 학생이 아니라 청구서를 만들 수 없습니다 — 학생을 다시 선택해 주세요", field: "studentId", op: "write" },
  // Declared and verified against the local 0456a migration; enabled with that migration.
  student_parent_event_recognitions_student_id_fkey: { message: "설명회 참석 기록이 있어 학생을 삭제할 수 없습니다", op: "delete" },
  // ── 학생 ──
  ux_students_active_natural_key: {
    message: "같은 이름·학교·학년의 학생이 이미 있습니다(퇴원생 제외) — 동명이인이면 이름 뒤에 구분 글자(A·B)를 붙여 주세요",
    field: "name",
  },
  ux_students_attendance_code_active: {
    message: "같은 출결번호를 쓰는 학생이 이미 있습니다(퇴원생 제외) — 다른 번호를 넣어 주세요",
    field: "attendanceCode",
  },
  invoices_student_id_students_id_fk: {
    message: "이 학생의 청구(수납) 기록이 있어 지울 수 없습니다 — 퇴원 처리를 이용해 주세요",
    op: "delete",
  },
  // ── 반·수강·세션 ──
  classes_tenant_name_subject_idx: { message: "같은 과목에 같은 이름의 반이 이미 있습니다", field: "name" },
  enrollments_no_overlap: { message: "이미 이 반에 기간이 겹치는 수강이 있습니다 — 수강 시작·종료일을 확인해 주세요" },
  enrollments_class_id_classes_id_fk: { message: "이 반에 수강 기록이 남아 있어 지울 수 없습니다", op: "delete" },
  operating_periods_no_overlap: { message: "세션 기간이 서로 겹칩니다 — 앞 세션의 끝과 다음 세션의 시작을 확인해 주세요" },
  operating_periods_label_uq: { message: "같은 달에 세션이 이미 있습니다 — 한 달에 하나만 저장할 수 있습니다" },
  makeup_reservations_uniq: { message: "같은 날 같은 교시에 이 학생의 보강 예약이 이미 있습니다" },
  lesson_reports_student_date_unit_key: { message: "같은 날 같은 수업의 보고서가 이미 있습니다" },
  checkins_tenant_student_date_idx: { message: "오늘 이미 등원 체크한 학생입니다" },
  attendance_session_units_range: { message: "시수는 0보다 크고 20 이하로 넣어 주세요" },
  // 이름 규약(_len·_dates_ck)과 정의가 다른 CHECK — 규약 문구로 떨어지면 틀린 말을 한다.
  class_textbook_plans_slot_picks_len: { message: "고른 교시 수가 허용 범위(1~48개)를 벗어났습니다" },
  // 0361a 적용 전엔 '25분 수업' 단위를 DB가 모른다 — "형식을 확인하세요"로 떨어지면 사람이 고칠 게 없다.
  class_textbook_plans_pace_chk: { message: "‘25분 수업’ 단위는 DB 업데이트(0361a) 적용 후 쓸 수 있습니다 — 지금은 다른 단위를 골라 주세요" },
  math_learning_goals_dates_ck: { message: "목표 기간은 시작일 이후, 2년(730일) 이내로 잡아 주세요" },
  leave_adjustments_used_range_ordered: { message: "사용 기간의 시작일이 비었거나 끝이 시작보다 빠릅니다" },
  // ── 강의실·교재 ──
  classrooms_tenant_name_idx: { message: "같은 이름의 강의실이 이미 있습니다(보관한 강의실 포함)", field: "name" },
  textbooks_tenant_title_uniq: { message: "같은 과목에 같은 이름의 교재가 이미 있습니다", field: "title" },
  textbook_lessons_pos_uniq: { message: "같은 차수가 이미 있습니다" },
  english_levels_tenant_abbr_idx: { message: "같은 약어의 영어 레벨이 이미 있습니다" },
  // ── 성적 ──
  ux_grades_term_slot_month: { message: "같은 시험의 성적이 이미 있습니다" },
  ux_grades_exam_student: { message: "이 시험에 이 학생의 성적이 이미 있습니다" },
  ux_grade_goals_cell: { message: "같은 시험의 목표 점수가 이미 있습니다" },
  // ── 직원·연동 ──
  users_tenant_email_idx: { message: "같은 이메일을 쓰는 직원 계정이 이미 있습니다", field: "email" },
  users_tenant_notion_user_id_key: { message: "이 노션 사용자는 이미 다른 직원과 연결되어 있습니다" },
  slack_user_links_tenant_id_slack_user_id_key: { message: "이 슬랙 사용자는 이미 다른 직원과 연결되어 있습니다" },
  staff_contracts_user_seq_idx: { message: "같은 차수의 계약서가 이미 있습니다" },
  payroll_tenant_user_period_idx: { message: "이 직원의 같은 달 급여 기록이 이미 있습니다" },
  payslips_tenant_id_user_id_period_key: { message: "이 직원의 같은 달 급여명세서가 이미 있습니다" },
  // ── 수납 ──
  invoices_tenant_student_period_idx: { message: "이 학생의 같은 달 청구서가 이미 있습니다" },
  // ── 결재·문서·태그 ──
  approval_line_templates_tenant_id_owner_id_name_key: { message: "같은 이름의 결재선이 이미 있습니다", field: "name" },
  approval_steps_document_id_approver_id_key: { message: "같은 결재자를 두 번 넣을 수 없습니다" },
  approval_refs_document_id_user_id_key: { message: "같은 참조자를 두 번 넣을 수 없습니다" },
  document_categories_sibling_label_uq: { message: "같은 상위 폴더에 같은 이름의 폴더가 있습니다" },
  academy_documents_category_fk: { message: "이 폴더에 문서가 있어 지울 수 없습니다", op: "delete" },
  document_categories_parent_fk: { message: "하위 폴더가 있어 지울 수 없습니다", op: "delete" },
  calendar_tags_name_unique: { message: "같은 이름의 태그가 이미 있습니다", field: "name" },
  report_templates_owner_name_uniq: { message: "같은 이름의 템플릿이 이미 있습니다 — 이름을 바꿔 주세요", field: "name" },
  // ── 셔틀 ──
  shuttle_stops_tenant_name_uniq: { message: "같은 이름의 정류장이 이미 있습니다", field: "name" },
  shuttle_runs_vehicle_season_no_uniq: { message: "이 차량의 같은 시즌에 같은 회차 번호가 이미 있습니다" },
  shuttle_run_stops_run_stop_uniq: { message: "이 회차에 이미 있는 정류장입니다" },
  shuttle_riders_stop_student_io_uniq: { message: "그 정류장에 이미 배정된 학생입니다" },
  shuttle_run_stops_stop_id_fkey: { message: "이 정류장을 쓰는 운행 회차가 있어 지울 수 없습니다", op: "delete" },
  // ── 재고 ──
  inventory_assets_code_uniq: { message: "같은 자산ID가 이미 있습니다" },
  inventory_supplies_code_uniq: { message: "같은 품목ID가 이미 있습니다" },
  inventory_categories_label_uniq: { message: "같은 이름의 분류가 이미 있습니다" },
  inventory_categories_prefix_uniq: { message: "같은 자산ID 접두를 쓰는 분류가 이미 있습니다" },
  inventory_loans_open_uniq: { message: "이미 대여 중인 자산입니다" },
  inventory_assets_category_fk: { message: "이 분류를 쓰는 자산이 있어 지울 수 없습니다", op: "delete" },
  // ── 지점(슈퍼관리자) ──
  tenants_slug_unique: { message: "같은 지점 코드를 쓰는 학원이 이미 있습니다" },
};

/** 직원이 남긴 기록이 직원 삭제를 막는 외래키들(운영 DB 확인: ON DELETE NO ACTION/RESTRICT, users 참조). */
const STAFF_AUTHORED_FKS = [
  "attendance_records_recorded_by_users_id_fk",
  "lesson_reports_covers_by_fkey",
  "invoice_session_terms_carryover_by_fkey",
  "help_answers_author_id_fkey",
  "help_posts_author_id_fkey",
  "support_requests_author_id_fkey",
];

export const CONSTRAINT_MESSAGES: Readonly<Record<string, ConstraintMessage>> = {
  ...DIRECT,
  ...Object.fromEntries(
    STAFF_AUTHORED_FKS.map((n) => [
      n,
      { message: "이 직원이 남긴 기록(출결·보고서·게시글 등)이 있어 지울 수 없습니다", op: "delete" as const },
    ]),
  ),
};

/**
 * CHECK 제약(23514)의 **이름 규약**으로 고르는 문구 — 우리 마이그레이션이 붙여 온 접미사다.
 * (`*_len` = 글자 수 범위 — 대개 `char_length(btrim(x)) between 1 and N`이라 **빈 값도** 걸린다,
 *  `*_range_ordered`·`*_order` 등 = 끝이 시작보다 앞설 수 없음.) 운영 DB 정의와 대조함(2026-10-01).
 */
export function checkConstraintMessage(name: string | null): string | null {
  if (!name) return null;
  if (/_len$/.test(name)) return "입력 길이가 허용 범위를 벗어났습니다 — 비어 있거나 너무 긴 칸이 있는지 확인해 주세요";
  if (/(_range_ordered|_period_ordered|_range_ck|_time_order|_slot_order|_end_after_start)$/.test(name)) {
    return "끝나는 날짜·시각이 시작보다 빠릅니다 — 날짜와 시각을 확인해 주세요";
  }
  return null;
}
