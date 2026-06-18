-- 0032a — 레벨테스트(배치/승급/진단) 기록. 손수 alpha 파일(0031a 다음). 전부 멱등.
-- 학생 상세 성적 탭의 '레벨테스트' 섹션. 과목별 세부점수는 subscores jsonb로 유연 수용(수학/영어 벤더별 상이).
-- ⚠️ drizzle migrate 대신 raw 적용. 의존: 0001a public.auth_tenant_id().

begin;

create table if not exists public.level_tests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  test_type text not null default 'placement', -- placement(배치)/promotion(승급)/diagnostic(진단)
  subject text not null, -- math/english/...
  tested_on date not null,
  level text, -- 결과 레벨/반/등급 (예: "상위반", "Level 5")
  subscores jsonb, -- 과목별 세부점수 {계산:.., 이해:.., ...} 또는 {어휘:.., 문법:.., ...}
  notes text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists level_tests_tenant_student_idx on public.level_tests (tenant_id, student_id);
create index if not exists level_tests_tenant_tested_idx on public.level_tests (tenant_id, tested_on);

-- RLS — 테넌트 격리(0001a 템플릿)
alter table public.level_tests enable row level security;
drop policy if exists level_tests_tenant_isolation on public.level_tests;
create policy level_tests_tenant_isolation on public.level_tests
  for all to authenticated
  using (tenant_id = public.auth_tenant_id())
  with check (tenant_id = public.auth_tenant_id());

commit;
