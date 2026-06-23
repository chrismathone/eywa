-- 0049a_lesson_reports.sql (손수 alpha)
-- 수업 진도/보고서 — ijw 시간표 학생 hover의 "[진도] 날짜+내용" 줄(Edutrix reports 이식).
-- 학생별 최신 1건이 hover에 표시됨. 진도/시험/숙제/담당강사. RLS 테넌트 격리.
create table if not exists lesson_reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  report_date date not null,
  progress text,          -- 진도 내용
  exam_info text,         -- 시험(분자/분모, 예 "7/25")
  homework_score text,    -- 과제 점수(예 "100%")
  teacher_name text,      -- 담당 강사(Edutrix class_name에서 추출)
  notes text,
  source text,            -- 출처 태그(예 'edutrix_import')
  created_at timestamptz not null default now()
);

create index if not exists lesson_reports_student_idx on lesson_reports (student_id, report_date desc);
create index if not exists lesson_reports_tenant_idx on lesson_reports (tenant_id);

alter table lesson_reports enable row level security;
drop policy if exists lesson_reports_tenant_isolation on lesson_reports;
create policy lesson_reports_tenant_isolation on lesson_reports
  for all
  using (tenant_id = public.auth_tenant_id())
  with check (tenant_id = public.auth_tenant_id());
