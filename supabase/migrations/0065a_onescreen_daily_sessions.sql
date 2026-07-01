-- 0065a_onescreen_daily_sessions.sql (손수 alpha)
-- 선생님 원스크린 "오늘 작업중" 상태를 서버에 영속 → 새로고침/재접속에도 유지.
-- 강사가 입력한 점수/진도/태도/과제/진도확정을 (student, session_date) 하루 1행으로 upsert.
-- lesson_reports(발송된 보고서 스냅샷)와는 별개 — 이건 입력 세션 상태. RLS 테넌트 격리.
create table if not exists onescreen_daily_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  session_date date not null,
  class_id uuid references classes(id) on delete set null,
  study_grade text,                                    -- 진도 학년(선행/후행)
  subject_progress jsonb not null default '{}'::jsonb, -- { subjectKey: { today: string, draft?: string } }
  daily_score int,
  daily_max int,
  check_score int,
  check_max int,
  attitude text,
  homework text,
  progress_confirmed boolean not null default false,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, student_id, session_date)         -- 하루 1행 upsert 앵커
);

create index if not exists onescreen_daily_sessions_lookup_idx
  on onescreen_daily_sessions (tenant_id, session_date, student_id);

alter table onescreen_daily_sessions enable row level security;
drop policy if exists onescreen_daily_sessions_tenant_isolation on onescreen_daily_sessions;
create policy onescreen_daily_sessions_tenant_isolation on onescreen_daily_sessions
  for all
  using (tenant_id = public.auth_tenant_id())
  with check (tenant_id = public.auth_tenant_id());
