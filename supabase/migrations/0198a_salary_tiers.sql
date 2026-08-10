-- 0198a — 강사 급여용 **수업 단가 티어** 배선 1단계 (스키마만, 순수 가산)
--
-- 원장 방향(2026-08-10): *"출석만 여기서 하고 계산은 같은 방식으로 한다면 급여자동화가 충분히 가능"*
-- 산식(3인 시트 실측으로 확정): 급여 행 = floor1(단가 × 실제시수 × 0.911 × 비율[강사×과정]).
-- 비율(users.commission_rates, 0130a)과 시수(attendance_records, 시트 이관)는 이미 있고,
-- **단가(수업 티어: "초등 3T"=21,250원 …)만 저장할 곳이 없다** — 이 파일이 그 자리를 만든다.
--
-- 구조 (시트의 실제 모양을 그대로 옮김):
--  ① salary_tiers          — 테넌트 단가표(티어 라벨 → 회당 단가). 시트 '수업 단가' 표.
--  ② enrollments.salary_tier — 학생×반의 티어(시트 '수업' 열). 같은 반 안에서도 학생마다 다르다
--     (실측: BS1J에 초등 2T·3T 혼재). 라벨 문자열 참조 — FK를 걸지 않는 이유는 단가표 행을
--     지워도 과거 수강의 티어 기록은 사실로 남아야 하기 때문(조인 실패 = 화면에서 '단가 미지정' 표시).
--  ③ attendance_records.salary_tier — **행 단위 예외**(드묾). 한 학생이 같은 반에서 두 티어를
--     소비하는 실측 사례(이수진 4명: 고등 3T 1T + 중등 3T 0.5T가 같은 날) — enrollment 티어로는
--     못 가르므로 그 기록만 티어를 직접 진다. null = enrollment 티어를 따른다(99% 경로).
--
-- 🔴 손실 방지 규율: 단가(금액)는 **master 전용 RLS의 salary_tiers에만** 있다. enrollments·
--    attendance_records에 얹는 것은 **라벨뿐**(금액 아님) — 강사가 읽어도 급여 정보가 새지 않는다
--    (0130a가 class_salary_settings를 classes에 안 붙인 것과 같은 결).
--
-- ⚠️ 순수 가산: 기존 행 전부 null, 아직 아무 코드도 이 칼럼·표를 읽지 않는다(적용해도 동작 불변).
--    앱 코드는 이 SQL이 적용된 것을 확인한 뒤 푸시한다([[#95]] — 앱 먼저 배포 금지).
-- 롤백: drop table salary_tiers;
--       alter table enrollments drop column salary_tier;
--       alter table attendance_records drop column salary_tier;
set local statement_timeout = '60s';

-- ① 테넌트 단가표
create table if not exists public.salary_tiers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  label text not null,                      -- 시트 표기 그대로: "초등 3T" · "의치대 중등" · "수학II (미적분I)"
  unit_price numeric(10, 2) not null        -- 회당 단가(원). 의치대 고등 29,166.75 같은 소수 단가 실존
    constraint salary_tiers_price_positive check (unit_price > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, label)
);

comment on table public.salary_tiers is
  '강사 급여용 수업 단가표(티어 라벨 → 회당 단가) — 원장 전용. 급여 = floor1(단가×시수×0.911×비율). 0198a';

create index if not exists salary_tiers_tenant_idx on public.salary_tiers (tenant_id);

alter table public.salary_tiers enable row level security;

-- master(원장)만 읽고 쓴다 — 단가는 급여 PII(0130a class_salary_settings와 동일 규율).
drop policy if exists salary_tiers_master_all on public.salary_tiers;
create policy salary_tiers_master_all on public.salary_tiers
  for all
  using (
    tenant_id = public.auth_tenant_id()
    and (select exists (
      select 1 from public.users u
      where u.id = (select auth.uid()) and u.system_role = 'master' and u.tenant_id = public.auth_tenant_id()
    ))
  )
  with check (
    tenant_id = public.auth_tenant_id()
    and (select exists (
      select 1 from public.users u
      where u.id = (select auth.uid()) and u.system_role = 'master' and u.tenant_id = public.auth_tenant_id()
    ))
  );

drop trigger if exists salary_tiers_set_updated_at on public.salary_tiers;
create trigger salary_tiers_set_updated_at
  before update on public.salary_tiers
  for each row execute function public.tg_set_updated_at();

-- ② 수강별 티어(라벨만 — 금액 아님)
alter table public.enrollments
  add column if not exists salary_tier text;

comment on column public.enrollments.salary_tier is
  '이 수강의 급여 단가 티어 라벨(salary_tiers.label 참조, FK 아님). null = 미지정(급여 산정에서 그 학생을 "단가 미지정"으로 표시). 0198a';

-- ③ 출결 행 단위 티어 예외(라벨만)
alter table public.attendance_records
  add column if not exists salary_tier text;

comment on column public.attendance_records.salary_tier is
  '이 출결 1건에만 적용하는 급여 티어 예외. null = 수강(enrollments.salary_tier)을 따름. 같은 반에서 두 티어를 소비하는 드문 사례(교시 분리 0.5T)용. 0198a';

notify pgrst, 'reload schema';
