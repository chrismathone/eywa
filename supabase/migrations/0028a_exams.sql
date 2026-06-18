-- 0028a — 시험(Exam) 1급 엔티티 + 일괄 성적입력 스키마.
-- ⚠️ 손수 alpha 파일: drizzle migrate 대신 raw 적용한다(0027 series 병합 직후 스냅샷 정식 재산출 전까지
--    db:generate 드리프트 회피, #P0-6). 전부 멱등(IF NOT EXISTS / drop+create). 정식 drizzle 번호본은
--    0027 reconciliation 시점에 재산출.
-- 의존: 0001a의 public.auth_tenant_id(). exams.id ← student_grades.exam_id FK.

begin;

-- A. exams — 시험 정의(반/학년/학원 단위 주간·모의·학교 시험) -----------------------
create table if not exists public.exams (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  subject text not null,
  exam_type text not null default 'weekly',   -- weekly/mock/school (주간/모의/학교)
  exam_date date not null,
  max_score numeric(6, 2),
  scope jsonb,                                 -- {type:'class'|'grade'|'academy', classIds?:[], grades?:[]}
  notes text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists exams_tenant_date_idx on public.exams (tenant_id, exam_date);
create index if not exists exams_tenant_subject_idx on public.exams (tenant_id, subject);

-- B. student_grades ← exam_id 링크 (nullable; 기존 자유텍스트 성적 무손실) -----------
alter table public.student_grades
  add column if not exists exam_id uuid references public.exams(id) on delete cascade;

-- 일괄 저장 upsert 키: 한 시험에 한 학생 한 행. exam_id NULL(자유입력 성적)은 제약 밖.
create unique index if not exists ux_grades_exam_student
  on public.student_grades (exam_id, student_id)
  where exam_id is not null;
create index if not exists grades_exam_idx on public.student_grades (exam_id);

-- C. RLS — exams tenant 격리(0001a/0027a 템플릿 그대로) ------------------------------
-- student_grades는 이미 RLS 보유(컬럼 추가만이라 정책 변경 불필요).
alter table public.exams enable row level security;
drop policy if exists exams_tenant_isolation on public.exams;
create policy exams_tenant_isolation on public.exams
  for all to authenticated
  using (tenant_id = public.auth_tenant_id())
  with check (tenant_id = public.auth_tenant_id());

commit;
