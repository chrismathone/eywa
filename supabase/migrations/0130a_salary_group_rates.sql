-- 0130a: 과정별 배분율(강사) + 반별 급여 설정(과정·비율) — 원장 확정 2026-07-21.
-- 산식: 급여 = 청구 × 0.911(수수료 8.9%) × **비율**. 비율 우선순위 = 반별 수동 > 과정별 > 강사 기본.
--
-- ① users.commission_rates jsonb — 과정별 배분율 {"초등":45,"중등":45,"고등":45,"수능":48,"특강":50}.
--    기존 users.commission_rate(0119a)는 **기본 비율**로 남는다(과정별·반별이 없을 때의 폴백).
-- ② class_salary_settings — 반별 수동 과정/비율. ⚠️ classes 테이블에 컬럼을 붙이지 않는다:
--    classes는 강사도 읽는 표라 급여 값이 같은 행에 섞이면 어떤 쿼리 실수로도 새어나갈 수 있다(#77).
--    별도 테이블 + **master 전용 RLS**로 DB 레벨에서 막는다(화면 게이트만으로는 부족).
-- 롤백 = drop table class_salary_settings; alter table users drop column commission_rates;

alter table public.users
  add column if not exists commission_rates jsonb;

comment on column public.users.commission_rates is
  '과정별 배분율 %(초등/중등/고등/수능/특강). 원장 전용 PII — 활동 로그 redact 대상(0130a). null/미입력 과정은 users.commission_rate(기본)로 폴백.';

create table if not exists public.class_salary_settings (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  class_id uuid primary key references public.classes(id) on delete cascade,
  -- 과정 수동 지정. null = 반 이름으로 자동 판정(초등M…), 이름에 근거가 없으면 미분류.
  salary_group text
    constraint class_salary_settings_group_check
    check (salary_group is null or salary_group in ('초등', '중등', '고등', '수능', '특강')),
  -- 반별 배분율 %. null = 과정별/기본 비율 사용.
  commission_rate numeric(5, 2)
    constraint class_salary_settings_rate_range
    check (commission_rate is null or (commission_rate >= 0 and commission_rate <= 100)),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null
);

comment on table public.class_salary_settings is
  '반별 급여 설정(과정·배분율) — 원장 전용. classes에 붙이지 않은 이유는 급여 PII 격리(0130a 주석 참조).';

create index if not exists class_salary_settings_tenant_idx on public.class_salary_settings (tenant_id);

alter table public.class_salary_settings enable row level security;

-- master(원장)만 읽고 쓴다. 강사·행정은 select조차 못 한다(급여 PII).
drop policy if exists class_salary_settings_master_all on public.class_salary_settings;
create policy class_salary_settings_master_all on public.class_salary_settings
  for all
  using (
    tenant_id = public.auth_tenant_id()
    and exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.system_role = 'master' and u.tenant_id = public.auth_tenant_id()
    )
  )
  with check (
    tenant_id = public.auth_tenant_id()
    and exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.system_role = 'master' and u.tenant_id = public.auth_tenant_id()
    )
  );
