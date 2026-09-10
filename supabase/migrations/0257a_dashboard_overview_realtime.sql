-- Overview refresh notifications. Additive and idempotent; does not change rows or RLS.
-- The client always retains 30-second polling (including deletes without a tenant_id payload).
-- Apply through the normal migration process. Missing optional tables are skipped.
do $$
declare target text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime publication unavailable; dashboard polling remains active';
    return;
  end if;
  foreach target in array array[
    'students', 'enrollments', 'classes', 'class_schedules', 'attendance_records',
    'invoices', 'expenses', 'enrollment_consultations', 'student_consultations',
    'student_onboarding_checks', 'lesson_reports', 'users', 'announcements',
    'meeting_minutes', 'academy_documents', 'approval_documents', 'approval_steps',
    'inventory_assets', 'inventory_supplies', 'calendar_events', 'leave_forms',
    'class_sheet_plan_lines', 'class_sheet_student_marks', 'shuttle_vehicles', 'exams'
  ] loop
    if exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = target and c.relrowsecurity
    ) and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = target
    ) then
      execute format('alter publication supabase_realtime add table public.%I', target);
    end if;
  end loop;
end $$;
