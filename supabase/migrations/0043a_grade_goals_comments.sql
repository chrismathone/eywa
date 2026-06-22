-- 0043a — 성적 목표설정(grade_goals) + 성적 코멘트(grade_comments). 손수 alpha 파일. 전부 멱등.
-- ijw GoalSetting / GradeComment 이식. 학생 상세 "성적" 탭에서 소비.
--   · grade_goals    = 학생별 목표 점수(과목·시험명 단위). 실제 점수(student_grades)와 매칭해 달성 여부 산출(읽기시).
--   · grade_comments = 학생별 학습 코멘트(카테고리/월/공유여부). 강사 피드백.
-- ⚠️ drizzle migrate 대신 raw 적용. IF NOT EXISTS / drop+create.
-- 의존: 0001a public.auth_tenant_id(), public.tg_set_updated_at().

begin;

-- ── 성적 목표설정 ──────────────────────────────────────────
create table if not exists public.grade_goals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  exam_id uuid references public.exams(id) on delete set null,
  exam_name text not null,
  subject text not null,
  target_score numeric(6, 2) not null,
  max_score numeric(6, 2),
  reason text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists grade_goals_tenant_student_idx on public.grade_goals (tenant_id, student_id);
create index if not exists grade_goals_exam_idx on public.grade_goals (exam_id);

alter table public.grade_goals enable row level security;
drop policy if exists grade_goals_tenant_isolation on public.grade_goals;
create policy grade_goals_tenant_isolation on public.grade_goals
  for all to authenticated
  using (tenant_id = public.auth_tenant_id())
  with check (tenant_id = public.auth_tenant_id());

drop trigger if exists grade_goals_set_updated_at on public.grade_goals;
create trigger grade_goals_set_updated_at
  before update on public.grade_goals
  for each row execute function public.tg_set_updated_at();

-- ── 성적 코멘트 ────────────────────────────────────────────
create table if not exists public.grade_comments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  category text not null,            -- strength/improvement/effort/potential/general
  subject text,                      -- NULL=전체, 또는 과목 키
  content text not null,
  period text not null,              -- 'YYYY-MM'
  shared_with_parent boolean not null default false,
  author_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists grade_comments_tenant_student_idx on public.grade_comments (tenant_id, student_id);
create index if not exists grade_comments_student_period_idx on public.grade_comments (tenant_id, student_id, period);

alter table public.grade_comments enable row level security;
drop policy if exists grade_comments_tenant_isolation on public.grade_comments;
create policy grade_comments_tenant_isolation on public.grade_comments
  for all to authenticated
  using (tenant_id = public.auth_tenant_id())
  with check (tenant_id = public.auth_tenant_id());

drop trigger if exists grade_comments_set_updated_at on public.grade_comments;
create trigger grade_comments_set_updated_at
  before update on public.grade_comments
  for each row execute function public.tg_set_updated_at();

commit;
