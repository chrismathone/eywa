-- s2_0096_assistant_scope.sql — 학원 비서: 묻는 사람의 권한 범위 안에서만 조회 · 2026-11-12
--
-- 원장 2026-11-12 *"학원 비서 — 각 역할에 맞는 답변만 출력되게(허용된 권한 이내에서)"* · Codex 합의 A+A′(앱 + DB가 같은 대응표로 막는다).
-- 지금까지(s2_0031) 증표에는 지점만 들어 있어 비서가 그 지점 보기 전부를 읽었다 — 그래서 원장만 쓰게 잠가 두었다(2026-11-12 임시 잠금).
--
-- 바꾸는 것
--   §1 대응표 — assistant_private.scope_tables(표 → 묶음 키) · scope_columns(칸 → 묶음 키). 🔴 대응표에 없는 표는 원장만('master').
--   §2 증표 v2 — 'v2.<지점>.<사람>.<묶음 키,…>.<만료>.<서명>'. 발급은 service_role만(public.assistant_issue_scoped_binding).
--      옛 발급 함수 assistant_issue_binding(지점)은 키 'master'로 v2 증표를 낸다(배포 전 옛 앱 = 원장만 쓰는 지금 그대로 — #95 순서).
--      assistant_private.bound_tenant()          = 증표가 맞으면 지점(종전 뜻 그대로 — 앱의 지점 확인)
--      assistant_private.bound_tenant(묶음 키)   = 증표가 맞고 그 키(또는 'master')가 있으면 지점, 아니면 null
--      🔴 보기 조건은 같은 함수 이름의 겹쳐 쓰기로 둔다 — 앱의 실행 계획 검사(executor.ts planProblem)가 assistant_private.bound_tenant만 받는다.
--   §3 보기 다시 만들기 — 모든 표 보기 조건에 묶음 키 · 대응표의 칸은 그 키가 없으면 null(값이 나가지 않는다). onto_* 보기는 원본 보기를 거쳐 그대로 상속한다
--      (원본이 막히면 그 쪽 값이 빈다 — LEFT JOIN으로 묶은 보기는 빈 칸 줄이 남는다. 앱은 원본이 모두 열릴 때만 onto 보기를 보인다).
--   §4 앱이 읽는 대응표(public.assistant_scope_map · service_role) — 앱은 이것으로 보기 목록·표 구조를 거른다(같은 원본).
--   §5 저장한 답·의견의 필요 묶음(assistant_messages.scope_keys · assistant_advice.scope_keys) — 다시 열 때 지금 권한으로 검사한다(null = 원장만).
--
-- 🔴 순서 = 이 SQL → 앱 배포(#95). 이 SQL만 적용된 동안 옛 앱은 'master' 증표로 지금과 똑같이 돈다(원장만 쓰는 임시 잠금 그대로).
-- 되돌리기 = scripts/_oneoff/revert-s2_0096-assistant-scope.sql(증표·보기를 s2_0067 때로 · 대응표·표지 칸은 남긴다 — 다시 적용하면 그대로 쓴다)

begin;
set local lock_timeout = '5s';
set local statement_timeout = '180s';

-- ── §1 대응표 ───────────────────────────────────────────────────────────────────────────────
create table if not exists assistant_private.scope_tables (
  table_name text primary key,
  scope_key text not null check (scope_key ~ '^[a-z][a-z0-9_]{0,31}$'),
  reason text
);
create table if not exists assistant_private.scope_columns (
  table_name text not null,
  column_name text not null,
  scope_key text not null check (scope_key ~ '^[a-z][a-z0-9_]{0,31}$'),
  reason text,
  primary key (table_name, column_name)
);
revoke all on assistant_private.scope_tables, assistant_private.scope_columns from public, anon, authenticated, service_role, aywa_assistant;

-- 대응표 줄(앱 src/features/assistant/scope.ts 묶음 규칙과 짝 — 가드 scope-map.test.ts가 이 파일을 읽어 맞춰 본다).
-- 🔴 외부 AI 전송 금지 필드(급여·계좌·이력서·환불 계좌 — CLAUDE.md '불변')는 원장만이다: 급여 단가·명세서·강사 몫 표, 지출 계좌 칸, 급여 등급 칸.
--    11-06 승인(학원 비서가 그 지점 표 전부를 조회)은 원장이 쓰던 때의 예외라 원장 밖 역할로 넓히지 않는다 — 열려면 원장에게 다시 묻는다.
-- @scope-tables-begin
insert into assistant_private.scope_tables (table_name, scope_key) values
  ('academy_documents', 'master'),
  ('academy_knowledge_records', 'master'),
  ('academy_model_versions', 'master'),
  ('academy_work_record_events', 'master'),
  ('academy_work_records', 'master'),
  ('activity_log', 'master'),
  ('ai_prompt_overrides', 'master'),
  ('ai_usage_logs', 'master'),
  ('announcements', 'master'),
  ('approval_basic_forms', 'master'),
  ('approval_comments', 'master'),
  ('approval_documents', 'master'),
  ('approval_expense_forms', 'master'),
  ('approval_income_forms', 'master'),
  ('approval_line_templates', 'master'),
  ('approval_refs', 'master'),
  ('approval_steps', 'master'),
  ('assistant_conversations', 'master'),
  ('attendance_checkins', 'attendance'),
  ('attendance_day_recaps', 'master'),
  ('attendance_followups', 'attendance'),
  ('attendance_notifications', 'master'),
  ('attendance_records', 'attendance'),
  ('attendance_salary_rates', 'master'),
  ('attendance_salary_teacher_view', 'master'),
  ('attendance_seat_share_adjust', 'master'),
  ('audit_logs', 'master'),
  ('before_class_checks', 'before_class_checklist'),
  ('before_class_targets', 'before_class_checklist'),
  ('calendar_events', 'calendar'),
  ('calendar_sync_state', 'master'),
  ('calendar_tags', 'calendar'),
  ('class_delegations', 'classes'),
  ('class_lesson_shifts', 'ecs'),
  ('class_month_plan_cells', 'ecs'),
  ('class_plan_import_batches', 'master'),
  ('class_salary_settings', 'master'),
  ('class_schedules', 'timetable'),
  ('class_sheet_goals', 'ecs'),
  ('class_sheet_memos', 'ecs'),
  ('class_sheet_month_memos', 'ecs'),
  ('class_sheet_plan_lines', 'ecs'),
  ('class_sheet_slot_flags', 'ecs'),
  ('class_sheet_student_marks', 'ecs'),
  ('class_splits', 'master'),
  ('class_textbook_plans', 'ecs'),
  ('classes', 'classes'),
  ('classnote_board_members', 'master'),
  ('classnote_board_sync_runs', 'master'),
  ('classnote_boards', 'master'),
  ('classnote_child_links', 'master'),
  ('classnote_class_board_members', 'master'),
  ('classnote_class_boards', 'master'),
  ('classnote_class_notices', 'master'),
  ('classnote_class_posts', 'lesson_reports'),
  ('classnote_english_class_boards', 'lesson_reports'),
  ('classnote_feed_state', 'master'),
  ('classnote_notices', 'master'),
  ('classnote_parent_message_attachments', 'master'),
  ('classnote_parent_messages', 'master'),
  ('classnote_parent_reactions', 'master'),
  ('classnote_parent_replies', 'master'),
  ('classnote_student_links', 'master'),
  ('classnote_sync_requests', 'master'),
  ('classnote_video_files', 'master'),
  ('classnote_video_folders', 'master'),
  ('classnote_video_history', 'master'),
  ('classnote_workers', 'master'),
  ('classrooms', 'timetable'),
  ('consultation_ai_analysis', 'enrollment'),
  ('consultation_recordings', 'enrollment'),
  ('daily_briefings', 'master'),
  ('dashboard_secretary_inputs', 'master'),
  ('dashboard_secretary_notes', 'master'),
  ('document_categories', 'documents'),
  ('document_folder_favorites', 'master'),
  ('duty_daily', 'master'),
  ('duty_dirty', 'master'),
  ('duty_items', 'master'),
  ('duty_notes', 'master'),
  ('duty_settings', 'master'),
  ('edutrix_archive', 'master'),
  ('english_levels', 'classes'),
  ('enrollment_consultations', 'enrollment'),
  ('enrollment_journey_records', 'enrollment'),
  ('enrollment_journey_revisions', 'master'),
  ('enrollments', 'students'),
  ('exams', 'exams'),
  ('expenses', 'billing'),
  ('grade_comments', 'exams'),
  ('grade_goals', 'exams'),
  ('help_answers', 'master'),
  ('help_posts', 'master'),
  ('homework_video_assignment_history', 'master'),
  ('homework_video_assignments', 'master'),
  ('homework_video_drive_account_owners', 'master'),
  ('homework_video_drive_connections', 'master'),
  ('homework_video_drive_oauth_attempts', 'master'),
  ('homework_video_drive_roots', 'master'),
  ('homework_video_drive_settings', 'master'),
  ('homework_video_link_uploads', 'master'),
  ('homework_video_links', 'master'),
  ('homework_video_reviews', 'master'),
  ('homework_video_site_attempts', 'master'),
  ('intake_attempts', 'master'),
  ('intake_tokens', 'master'),
  ('inventory_assets', 'inventory'),
  ('inventory_audits', 'inventory'),
  ('inventory_categories', 'inventory'),
  ('inventory_loans', 'inventory'),
  ('inventory_supplies', 'inventory'),
  ('inventory_vendors', 'inventory'),
  ('invoice_session_terms', 'billing'),
  ('invoice_teacher_splits', 'master'),
  ('invoices', 'billing'),
  ('kakao_channels', 'master'),
  ('kiosk_devices', 'master'),
  ('lab_menu_assignments', 'master'),
  ('leave_adjustments', 'master'),
  ('leave_forms', 'master'),
  ('lesson_report_rating_queue', 'master'),
  ('lesson_report_ratings', 'master'),
  ('lesson_report_send_events', 'master'),
  ('lesson_report_write_timings', 'master'),
  ('lesson_reports', 'lesson_reports'),
  ('level_tests', 'exams'),
  ('login_events', 'master'),
  ('love_note_suggestions', 'master'),
  ('makeedu_history_bills', 'master'),
  ('makeedu_history_events', 'master'),
  ('makeedu_history_students', 'master'),
  ('makeedu_push_batches', 'master'),
  ('makeedu_push_requests', 'master'),
  ('makeedu_sync_requests', 'master'),
  ('makeedu_sync_runs', 'master'),
  ('makeedu_sync_state', 'master'),
  ('makeedu_sync_workers', 'master'),
  ('makeup_adjustments', 'makeups'),
  ('makeup_allocations', 'makeups'),
  ('makeup_case_sources', 'master'),
  ('makeup_cases', 'makeups'),
  ('makeup_commands', 'master'),
  ('makeup_events', 'master'),
  ('makeup_fulfillments', 'makeups'),
  ('makeup_legacy_maps', 'master'),
  ('makeup_participants', 'makeups'),
  ('makeup_policy_versions', 'master'),
  ('makeup_projection_jobs', 'master'),
  ('makeup_recognitions', 'makeups'),
  ('makeup_reconciliation', 'master'),
  ('makeup_reconciliation_runs', 'master'),
  ('makeup_reservations', 'attendance'),
  ('makeup_sessions', 'makeups'),
  ('management_accounting_reports', 'master'),
  ('management_accounting_versions', 'master'),
  ('management_ai_reviews', 'master'),
  ('management_collection_devices', 'master'),
  ('management_collection_settings', 'master'),
  ('management_review_events', 'master'),
  ('management_source_batches', 'master'),
  ('marketing_archive_audit', 'master'),
  ('marketing_archive_events', 'master'),
  ('marketing_archive_sources', 'master'),
  ('marketing_archive_students', 'master'),
  ('marketing_source_inbox', 'master'),
  ('math_book_targets', 'mcs'),
  ('math_learning_goals', 'mcs'),
  ('math_learning_track_goals', 'mcs'),
  ('math_month_goals', 'mcs'),
  ('math_textbook_assignments', 'mcs'),
  ('meeting_minutes', 'meetings'),
  ('ment_ai_drafts', 'master'),
  ('migration_data_marks', 'master'),
  ('notice_dismissals', 'master'),
  ('notice_popup_translations', 'master'),
  ('notice_popups', 'master'),
  ('notification_events', 'master'),
  ('notifications', 'master'),
  ('onescreen_daily_sessions', 'master'),
  ('onescreen_student_order', 'master'),
  ('operating_periods', 'timetable'),
  ('operator_tenant_views', 'master'),
  ('organization_okr', 'okr'),
  ('organization_okr_revisions', 'okr'),
  ('page_usage_daily', 'master'),
  ('parent_account_students', 'master'),
  ('parent_accounts', 'master'),
  ('parent_departure_acks', 'master'),
  ('payroll_records', 'master'),
  ('payslips', 'master'),
  ('progress_containers', 'master'),
  ('progress_entries', 'master'),
  ('progress_events', 'master'),
  ('push_subscriptions', 'master'),
  ('record_coverage_marks', 'master'),
  ('reenrollment_campaign_targets', 'retention'),
  ('report_jj_snapshots', 'master'),
  ('report_templates', 'master'),
  ('salary_tiers', 'master'),
  ('school_enrollment_stats', 'master'),
  ('school_exam_periods', 'textbooks'),
  ('seat_period_moves', 'seat_attendance'),
  ('seat_period_pins', 'seat_attendance'),
  ('seat_placements', 'seat_attendance'),
  ('share_link_views', 'master'),
  ('shuttle_boardings', 'shuttle'),
  ('shuttle_history_acks', 'master'),
  ('shuttle_ride_exception_history', 'shuttle'),
  ('shuttle_ride_exceptions', 'shuttle'),
  ('shuttle_rider_history', 'shuttle'),
  ('shuttle_riders', 'shuttle'),
  ('shuttle_run_stops', 'shuttle'),
  ('shuttle_runs', 'shuttle'),
  ('shuttle_stops', 'shuttle'),
  ('shuttle_trips', 'shuttle'),
  ('shuttle_vehicle_positions', 'master'),
  ('shuttle_vehicles', 'shuttle'),
  ('slack_connections', 'master'),
  ('slack_inbox', 'master'),
  ('slack_link_codes', 'master'),
  ('slack_outbox', 'master'),
  ('slack_rules', 'master'),
  ('slack_user_links', 'master'),
  ('staff_attendance_days', 'master'),
  ('staff_contracts', 'master'),
  ('staff_leaves', 'master'),
  ('staff_task_assignees', 'master'),
  ('staff_task_events', 'master'),
  ('staff_task_notifications', 'master'),
  ('staff_tasks', 'master'),
  ('student_care_commitments', 'master'),
  ('student_care_events', 'master'),
  ('student_consultation_rating_queue', 'master'),
  ('student_consultation_ratings', 'master'),
  ('student_consultations', 'consultations'),
  ('student_contribution_factor_records', 'master'),
  ('student_contribution_months', 'master'),
  ('student_contribution_settings', 'master'),
  ('student_daily_stats', 'master'),
  ('student_flow_insights', 'master'),
  ('student_grades', 'exams'),
  ('student_history_monthly', 'master'),
  ('student_homework_videos', 'master'),
  ('student_memos', 'students'),
  ('student_onboarding_checks', 'newcomers'),
  ('student_onboarding_feedback', 'newcomers'),
  ('student_onboarding_followup_events', 'master'),
  ('student_onboarding_manager_defaults', 'master'),
  ('student_onboarding_subject_assignments', 'newcomers'),
  ('student_ontology_summaries', 'master'),
  ('student_ontology_summary_daily_usage', 'master'),
  ('student_parent_event_imports', 'master'),
  ('student_parent_event_recognitions', 'master'),
  ('student_parent_event_registrations', 'master'),
  ('student_parent_event_revisions', 'master'),
  ('student_parent_events', 'master'),
  ('student_positive_signals', 'master'),
  ('student_siblings', 'students'),
  ('students', 'students'),
  ('super_admin_audit_logs', 'master'),
  ('super_admins', 'master'),
  ('support_notices', 'master'),
  ('support_requests', 'master'),
  ('sync_agent_attempts', 'master'),
  ('sync_agent_codes', 'master'),
  ('sync_agent_devices', 'master'),
  ('sync_agent_events', 'master'),
  ('sync_agent_management_codes', 'master'),
  ('sync_agent_module_sessions', 'master'),
  ('sync_agent_releases', 'master'),
  ('sync_agent_schedule_runs', 'master'),
  ('sync_agent_settings', 'master'),
  ('teacher_capacity_events', 'master'),
  ('teacher_capacity_plans', 'master'),
  ('teacher_evaluation_entries', 'master'),
  ('teacher_evaluation_presets', 'master'),
  ('teacher_evaluation_settings', 'master'),
  ('teacher_ment_styles', 'master'),
  ('teacher_portfolio_months', 'master'),
  ('teacher_satisfaction_claims', 'master'),
  ('teacher_satisfaction_judgments', 'master'),
  ('teacher_schedule_blocks', 'master'),
  ('tenant_ai_models', 'master'),
  ('tenant_licenses', 'master'),
  ('tenant_settings', 'master'),
  ('tenants', 'master'),
  ('textbook_catalog', 'textbook_requests'),
  ('textbook_lessons', 'textbooks'),
  ('textbook_orders', 'textbook_requests'),
  ('textbooks', 'textbooks'),
  ('timetable_cell_memos', 'master'),
  ('timetable_import_logs', 'master'),
  ('timetable_lab_apply_jobs', 'master'),
  ('timetable_lab_drafts', 'master'),
  ('timetable_memo_sheets', 'master'),
  ('timetable_snapshots', 'master'),
  ('todays_math_exam_report_links', 'master'),
  ('todays_math_result_days', 'master'),
  ('todays_math_test_results', 'exams'),
  ('tuition_catalog', 'billing'),
  ('tuition_quotes', 'billing'),
  ('user_integrations', 'master'),
  ('users', 'staff'),
  ('video_homework_auto_outcomes', 'master'),
  ('video_homework_automation_config', 'master'),
  ('video_homework_cancels', 'master'),
  ('video_homework_extra_issues', 'master'),
  ('video_homework_marks', 'master'),
  ('video_homework_rejections', 'master'),
  ('withdrawal_report_archive_mappings', 'master'),
  ('withdrawal_report_archives', 'master'),
  ('withdrawal_report_events', 'master'),
  ('withdrawal_report_groups', 'master'),
  ('withdrawal_report_refund_decisions', 'master'),
  ('withdrawal_report_refunds', 'master'),
  ('withdrawal_report_sources', 'master'),
  ('withdrawal_reports', 'master'),
  ('withdrawal_write_turns', 'master'),
  ('work_request_assignees', 'master'),
  ('work_request_events', 'master'),
  ('work_request_links', 'master'),
  ('work_requests', 'master'),
  ('worker_execution_leases', 'master')
on conflict (table_name) do update set scope_key = excluded.scope_key;
-- @scope-tables-end

-- @scope-columns-begin
insert into assistant_private.scope_columns (table_name, column_name, scope_key) values
  ('academy_documents', 'form_data', 'master'),
  ('attendance_records', 'salary_tier', 'master'),
  ('enrollment_consultations', 'parent_phone', 'enrollment'),
  ('enrollments', 'salary_tier', 'master'),
  ('expenses', 'account_number', 'master'),
  ('expenses', 'bank_name', 'master'),
  ('payslips', 'print_payload', 'master'),
  ('students', 'address', 'students'),
  ('students', 'address_detail', 'students'),
  ('students', 'attendance_code', 'master'),
  ('students', 'birth_date', 'students'),
  ('students', 'email', 'students'),
  ('students', 'home_phone', 'students'),
  ('students', 'other_phone', 'students'),
  ('students', 'parent2_name', 'students'),
  ('students', 'parent2_phone', 'students'),
  ('students', 'parent2_relation', 'students'),
  ('students', 'parent_name', 'students'),
  ('students', 'parent_phone', 'students'),
  ('students', 'parent_relation', 'students'),
  ('students', 'student_phone', 'students'),
  ('students', 'zip_code', 'students'),
  ('users', 'commission_rate', 'master'),
  ('users', 'commission_rates', 'master'),
  ('users', 'email', 'staff'),
  ('users', 'employment_type', 'staff'),
  ('users', 'hire_date', 'staff'),
  ('users', 'hourly_rate', 'master'),
  ('users', 'memo', 'master'),
  ('users', 'monthly_base', 'master'),
  ('users', 'phone', 'staff'),
  ('users', 'salary_type', 'master'),
  ('users', 'ui_prefs', 'master'),
  ('users', 'work_schedule', 'staff')
on conflict (table_name, column_name) do update set scope_key = excluded.scope_key;
-- @scope-columns-end

-- ── §2 증표 v2 ──────────────────────────────────────────────────────────────────────────────
-- 증표 글자를 검사해 [지점, 사람, 키 목록]을 돌려준다(서명·만료·꼴이 하나라도 틀리면 null). 비서 역할은 부를 수 없다(아래 bound_tenant가 부른다).
create or replace function assistant_private.binding_claims() returns text[]
language plpgsql stable security definer parallel restricted set search_path = '' as $$
declare
  v_token text := current_setting('assistant.binding', true);
  v_parts text[];
begin
  if v_token is null or v_token = '' or length(v_token) > 4000 then return null; end if;
  v_parts := string_to_array(v_token, '.');
  if coalesce(array_length(v_parts, 1), 0) <> 6
     or v_parts[1] <> 'v2'
     or v_parts[2] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or v_parts[3] !~ '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|-)$'
     or v_parts[4] !~ '^[a-z][a-z0-9_]{0,31}(,[a-z][a-z0-9_]{0,31}){0,63}$'
     or v_parts[5] !~ '^[0-9]{1,12}$'
     or v_parts[6] !~ '^[0-9a-f]{64}$' then
    return null;
  end if;
  if v_parts[5]::bigint < extract(epoch from now())::bigint then return null; end if;
  if encode(extensions.hmac(convert_to(array_to_string(v_parts[1:5], '.'), 'UTF8'), (select k.key from assistant_private.signing_key k where k.id), 'sha256'), 'hex') <> v_parts[6] then
    return null;
  end if;
  return array[v_parts[2], v_parts[3], v_parts[4]];
end $$;

create or replace function assistant_private.bound_tenant() returns uuid
language plpgsql stable security definer parallel restricted set search_path = '' as $$
declare
  v_claims text[] := assistant_private.binding_claims();
begin
  if v_claims is null then return null; end if;
  return v_claims[1]::uuid;
end $$;

create or replace function assistant_private.bound_tenant(p_scope text) returns uuid
language plpgsql stable security definer parallel restricted set search_path = '' as $$
declare
  v_claims text[] := assistant_private.binding_claims();
  v_keys text[];
begin
  if v_claims is null or p_scope is null then return null; end if;
  v_keys := string_to_array(v_claims[3], ',');
  if 'master' = any(v_keys) or p_scope = any(v_keys) then return v_claims[1]::uuid; end if;
  return null;
end $$;

-- 발급(service_role만) — 사람은 그 지점 직원이어야 하고, 키는 1~64개 · 꼴 검사 · 정렬·중복 제거.
create or replace function public.assistant_issue_scoped_binding(p_tenant uuid, p_user uuid, p_keys text[]) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_keys text;
  v_payload text;
begin
  if p_tenant is null or not exists (select 1 from public.tenants t where t.id = p_tenant) then
    raise exception 'assistant binding: 없는 지점' using errcode = '22023';
  end if;
  if p_user is not null and not exists (select 1 from public.users u where u.id = p_user and u.tenant_id = p_tenant) then
    raise exception 'assistant binding: 이 지점 직원이 아닙니다' using errcode = '22023';
  end if;
  select string_agg(k, ',' order by k) into v_keys from (select distinct k from unnest(p_keys) k) x;
  if v_keys is null or v_keys !~ '^[a-z][a-z0-9_]{0,31}(,[a-z][a-z0-9_]{0,31}){0,63}$' then
    raise exception 'assistant binding: 묶음 키가 맞지 않습니다' using errcode = '22023';
  end if;
  v_payload := 'v2.' || p_tenant::text || '.' || coalesce(p_user::text, '-') || '.' || v_keys || '.'
               || extract(epoch from now() + interval '5 minutes')::bigint::text;
  return v_payload || '.' || encode(extensions.hmac(convert_to(v_payload, 'UTF8'), (select k.key from assistant_private.signing_key k where k.id), 'sha256'), 'hex');
end $$;

-- 옛 발급 — 이 SQL과 새 앱 배포 사이에 도는 옛 앱(원장만 씀)용. 'master' 키로 낸다(지금 뜻 그대로).
create or replace function public.assistant_issue_binding(p_tenant uuid) returns text
language plpgsql security definer set search_path = '' as $$
begin
  return public.assistant_issue_scoped_binding(p_tenant, null, array['master']);
end $$;

-- ── §3 보기 다시 만들기 ─────────────────────────────────────────────────────────────────────
create or replace function assistant_private.schema_signature() returns text
language sql stable security definer set search_path = '' as $$
  select md5(
    coalesce((select string_agg(c.relname || '.' || a.attname || ':' || a.atttypid::text, ',' order by c.relname, a.attnum)
                from pg_class c
                join pg_namespace n on n.oid = c.relnamespace
                join pg_attribute a on a.attrelid = c.oid
               where n.nspname = 'public' and c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped), '')
    || '|' || coalesce((select string_agg(table_name, ',' order by table_name) from assistant_private.excluded_tables), '')
    || '|' || coalesce((select string_agg(table_name || '.' || column_name, ',' order by table_name, column_name) from assistant_private.hidden_columns), '')
    || '|' || coalesce((select string_agg(table_name || '.' || column_name || '=' || expr, ',' order by table_name, column_name) from assistant_private.masked_columns), '')
    || '|' || coalesce((select string_agg(table_name || '=' || scope_key, ',' order by table_name) from assistant_private.scope_tables), '')
    || '|' || coalesce((select string_agg(table_name || '.' || column_name || '=' || scope_key, ',' order by table_name, column_name) from assistant_private.scope_columns), '')
    || '|rules-v3'
  )
$$;

create or replace function assistant_private.refresh_views() returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '3s' as $$
declare
  r record;
  v_cols text;
  v_bind text;
  v_n integer := 0;
  v_sig text := assistant_private.schema_signature();
begin
  perform pg_advisory_xact_lock(hashtext('assistant_private.refresh_views'));
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'assistant' and c.relkind = 'v' loop
    execute format('drop view if exists assistant.%I cascade', r.relname);
  end loop;

  for r in
    select c.oid, c.relname,
           exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped) as has_tenant,
           -- 🔴 대응표에 없는 표 = 원장만(닫는 쪽 — 새 표가 생겨도 원장 밖에는 열리지 않는다).
           coalesce((select s.scope_key from assistant_private.scope_tables s where s.table_name = c.relname), 'master') as scope_key
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p')
       and not exists (select 1 from assistant_private.excluded_tables x where x.table_name = c.relname)
     order by c.relname
  loop
    -- 칸 = (가림식 또는 원래 칸) → 대응표의 칸이면 그 키가 있을 때만 값(없으면 null — 앱은 표 구조에서도 숨긴다).
    -- 🔴 coalesce(format(...))로 쓰지 말 것 — format은 NULL을 빈 글자로 바꿔 '() as 칸'이 된다(s2_0031).
    select string_agg(
             case
               when sc.scope_key is not null then
                 format('(case when (select assistant_private.bound_tenant(%L)) is not null then %s end) as %I',
                        sc.scope_key, case when m.expr is not null then format('(%s)', m.expr) else format('t.%I', a.attname) end, a.attname)
               when m.expr is not null then format('(%s) as %I', m.expr, a.attname)
               else format('t.%I', a.attname)
             end, ', ' order by a.attnum)
      into v_cols
      from pg_attribute a
      left join assistant_private.masked_columns m on m.table_name = r.relname and m.column_name = a.attname
      left join assistant_private.scope_columns sc on sc.table_name = r.relname and sc.column_name = a.attname
     where a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped
       and not assistant_private.secret_column(a.attname)
       and not exists (select 1 from assistant_private.hidden_columns h where h.table_name = r.relname and h.column_name = a.attname);
    continue when v_cols is null;
    v_bind := format('(select assistant_private.bound_tenant(%L))', r.scope_key);

    if r.has_tenant then
      execute format('create view assistant.%I with (security_barrier = true) as select %s from public.%I t where t.tenant_id = %s',
                     r.relname, v_cols, r.relname, v_bind);
    elsif r.relname = 'tenants' then
      execute format('create view assistant.tenants with (security_barrier = true) as select %s from public.tenants t where t.id = %s', v_cols, v_bind);
    elsif r.relname = 'consultation_ai_analysis' then
      execute format('create view assistant.consultation_ai_analysis with (security_barrier = true) as select %s from public.consultation_ai_analysis t
                       where exists (select 1 from public.enrollment_consultations p where p.id = t.consultation_id and p.tenant_id = %s)', v_cols, v_bind);
    elsif r.relname = 'notice_popup_translations' then
      execute format('create view assistant.notice_popup_translations with (security_barrier = true) as select %s from public.notice_popup_translations t
                       where exists (select 1 from public.notice_popups p where p.id = t.notice_id and p.tenant_id = %s)', v_cols, v_bind);
    else
      continue; -- 지점 칸도 지점 부모도 없는 표 = 학원 자료가 아니다(s2_0031)
    end if;
    v_n := v_n + 1;
  end loop;

  -- onto_* = 원본 보기(assistant.*)만 읽는다 → 원본의 묶음 조건을 그대로 상속한다(막힌 원본은 비어 보인다 — 앱이 그 onto 보기를 목록에서 뺀다).
  perform assistant_private.create_ontology_views();

  execute 'revoke all on all tables in schema assistant from public, anon, authenticated, service_role';
  execute 'grant select on all tables in schema assistant to aywa_assistant';

  insert into assistant_private.state (id, signature, refreshed_at, views) values (true, v_sig, now(), v_n)
  on conflict (id) do update set signature = excluded.signature, refreshed_at = excluded.refreshed_at, views = excluded.views;
  return jsonb_build_object('views', v_n, 'signature', v_sig);
end $$;

-- ── §4 앱이 읽는 대응표 ─────────────────────────────────────────────────────────────────────
-- 휘발성 기본(volatile) — 서버 키로만 부르는 함수라 '지점 보기' 읽기 목록(tenant-view)에 들 자리가 아니다.
create or replace function public.assistant_scope_map() returns jsonb
language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'tables', coalesce((select jsonb_object_agg(s.table_name, s.scope_key) from assistant_private.scope_tables s), '{}'::jsonb),
    'columns', coalesce((select jsonb_agg(jsonb_build_object('table', c.table_name, 'column', c.column_name, 'key', c.scope_key) order by c.table_name, c.column_name)
                           from assistant_private.scope_columns c), '[]'::jsonb)
  )
$$;

-- ── §5 저장한 답·의견의 필요 묶음 ───────────────────────────────────────────────────────────
alter table public.assistant_messages add column if not exists scope_keys text[];
alter table public.assistant_advice add column if not exists scope_keys text[];
comment on column public.assistant_messages.scope_keys is '이 답이 쓴 자료의 묶음 키(s2_0096) — 다시 열 때 지금 권한이 다 덮어야 보인다 · null = 원장만';
comment on column public.assistant_advice.scope_keys is '이 의견의 확인 지표가 쓰는 자료의 묶음 키(s2_0096) — 재측정·목록은 만든 사람의 지금 권한과 맞춰 본다 · null = 원장만';

-- ── 권한 마무리 ─────────────────────────────────────────────────────────────────────────────
revoke all on all functions in schema assistant_private from public, anon, authenticated, service_role, aywa_assistant;
grant execute on function assistant_private.bound_tenant() to aywa_assistant;
grant execute on function assistant_private.bound_tenant(text) to aywa_assistant;
revoke all on function public.assistant_issue_scoped_binding(uuid, uuid, text[]) from public, anon, authenticated, aywa_assistant;
grant execute on function public.assistant_issue_scoped_binding(uuid, uuid, text[]) to service_role;
revoke all on function public.assistant_issue_binding(uuid) from public, anon, authenticated, aywa_assistant;
grant execute on function public.assistant_issue_binding(uuid) to service_role;
revoke all on function public.assistant_scope_map() from public, anon, authenticated, aywa_assistant;
grant execute on function public.assistant_scope_map() to service_role;

select assistant_private.refresh_views();

-- ── 사후 확인 ───────────────────────────────────────────────────────────────────────────────
do $$
declare
  r record;
  v_views integer;
  v_fns text;
  v_bad text;
  v_tenant uuid;
  v_all bigint;
  v_cut bigint;
  v_tok text;
begin
  select count(*) into v_views from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'assistant' and c.relkind = 'v';
  if v_views < 200 then raise exception 's2_0096 사후 확인: 보기가 %개뿐입니다', v_views; end if;

  -- 비서 역할이 부를 수 있는 보안 정의자 함수 = bound_tenant 두 개뿐.
  select string_agg(p.oid::regprocedure::text, ', ') into v_fns
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname not in ('pg_catalog', 'information_schema')
     and p.prosecdef
     and p.oid not in ('assistant_private.bound_tenant()'::regprocedure, 'assistant_private.bound_tenant(text)'::regprocedure)
     and p.prorettype <> 'trigger'::regtype
     and has_schema_privilege('aywa_assistant', n.oid, 'usage')
     and has_function_privilege('aywa_assistant', p.oid, 'execute');
  if v_fns is not null then raise exception 's2_0096 사후 확인: 비서 역할이 보안 정의자 함수를 부를 수 있습니다: %', v_fns; end if;
  if has_function_privilege('aywa_assistant', 'public.assistant_issue_scoped_binding(uuid, uuid, text[])', 'execute')
     or has_function_privilege('authenticated', 'public.assistant_issue_scoped_binding(uuid, uuid, text[])', 'execute')
     or has_function_privilege('authenticated', 'public.assistant_scope_map()', 'execute') then
    raise exception 's2_0096 사후 확인: 증표 발급·대응표 함수가 service_role 밖에 열려 있습니다';
  end if;

  -- 표 보기는 모두 묶음 키를 단 bound_tenant(키)로만 묶인다(키 없는 옛 조건이 남으면 범위가 새지 않게 멈춘다).
  select string_agg(c.relname, ', ') into v_bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'assistant' and c.relkind = 'v' and c.relname not like 'onto\_%' escape '\'
     and (pg_get_viewdef(c.oid) like '%bound_tenant()%' or pg_get_viewdef(c.oid) not like '%bound_tenant(%');
  if v_bad is not null then raise exception 's2_0096 사후 확인: 묶음 키 없이 묶인 보기: %', v_bad; end if;

  -- 칸 가림이 칸마다 실제로 걸리는지 — 표와 다른 키로 가린 칸마다, 그 칸 값이 있는 지점에서 표 키만 단 증표로 읽으면 값이 0개여야 한다
  -- (보기 정의 글자 검사는 같은 키의 다른 칸이 감싸여 있으면 지나간다 · 재리뷰 2026-11-12). 원장만인 표는 표째 닫혀 건너뛴다.
  for r in
    select sc.table_name, sc.column_name, sc.scope_key, st.scope_key as table_key
      from assistant_private.scope_columns sc
      join assistant_private.scope_tables st on st.table_name = sc.table_name
     where st.scope_key <> 'master' and sc.scope_key <> st.scope_key
       and to_regclass(format('assistant.%I', sc.table_name)) is not null
       and exists (select 1 from pg_attribute a where a.attrelid = format('public.%I', sc.table_name)::regclass and a.attname = 'tenant_id' and not a.attisdropped)
       and exists (select 1 from pg_attribute a where a.attrelid = format('assistant.%I', sc.table_name)::regclass and a.attname = sc.column_name and not a.attisdropped)
  loop
    execute format('select t.tenant_id from public.%I t where t.%I is not null limit 1', r.table_name, r.column_name) into v_tenant;
    continue when v_tenant is null;
    perform set_config('assistant.binding', public.assistant_issue_scoped_binding(v_tenant, null, array[r.table_key]), true);
    -- 같은 증표로 행이 실제로 나와야 '값 0개'가 칸 가림 때문이라고 말할 수 있다(표 키가 틀려 표째 0행이면 지나간다 · 재리뷰 2026-11-12).
    execute format('select count(*) from assistant.%I', r.table_name) into v_all;
    if v_all = 0 then raise exception 's2_0096 사후 확인: % 보기가 % 증표로 0행입니다(표 키 확인)', r.table_name, r.table_key; end if;
    execute format('select count(%I) from assistant.%I', r.column_name, r.table_name) into v_cut;
    if v_cut <> 0 then raise exception 's2_0096 사후 확인: 칸 가림이 걸리지 않습니다(%.% — % 증표로 %개)', r.table_name, r.column_name, r.table_key, v_cut; end if;
  end loop;
  perform set_config('assistant.binding', '', true);

  -- 서명이 틀린 증표 = 지점도 null(자료와 무관하게 — 아무 지점이나 하나로).
  select t.id into v_tenant from public.tenants t order by t.id limit 1;
  if v_tenant is not null then
    v_tok := public.assistant_issue_scoped_binding(v_tenant, null, array['master']);
    perform set_config('assistant.binding', v_tok, true);
    if assistant_private.bound_tenant() is distinct from v_tenant or assistant_private.bound_tenant('students') is distinct from v_tenant then
      raise exception 's2_0096 사후 확인: master 증표가 지점을 돌려주지 않습니다';
    end if;
    perform set_config('assistant.binding', left(v_tok, length(v_tok) - 1) || case when right(v_tok, 1) = '0' then '1' else '0' end, true);
    if assistant_private.bound_tenant() is not null then raise exception 's2_0096 사후 확인: 서명이 틀린 증표가 통과합니다'; end if;
    perform set_config('assistant.binding', public.assistant_issue_scoped_binding(v_tenant, null, array['zz_probe']), true);
    if assistant_private.bound_tenant('students') is not null or assistant_private.bound_tenant('zz_probe') is distinct from v_tenant then
      raise exception 's2_0096 사후 확인: 묶음 키 판정이 맞지 않습니다';
    end if;
  end if;

  -- 실제 보기에 걸리는지 — 감사 기록이 있는 지점에서, 원장만인 보기(audit_logs)가 다른 키 증표로는 0행 · master 증표로는 그대로.
  select a.tenant_id into v_tenant from public.audit_logs a group by a.tenant_id order by count(*) desc limit 1;
  if v_tenant is not null and to_regclass('assistant.audit_logs') is not null
     and not exists (select 1 from assistant_private.scope_tables where table_name = 'audit_logs' and scope_key <> 'master') then
    perform set_config('assistant.binding', public.assistant_issue_scoped_binding(v_tenant, null, array['master']), true);
    select count(*) into v_all from assistant.audit_logs;
    perform set_config('assistant.binding', public.assistant_issue_scoped_binding(v_tenant, null, array['zz_probe']), true);
    select count(*) into v_cut from assistant.audit_logs;
    if v_all = 0 or v_cut <> 0 then raise exception 's2_0096 사후 확인: 범위 증표가 걸리지 않습니다(master %행 · 다른 키 %행)', v_all, v_cut; end if;
  end if;
  perform set_config('assistant.binding', '', true);
end $$;

notify pgrst, 'reload schema';
commit;
