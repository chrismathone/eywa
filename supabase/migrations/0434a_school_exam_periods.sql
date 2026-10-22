-- 학교별 내신기간(원장 2026-10-20 *"학교마다 내신기간이 다름 학교별로 내신기간 반영되게"*).
--
-- 🔑 한 줄 = 학교 하나의 한 학년도 시험 하나(1학기 중간·기말 / 2학기 중간·기말)의 기간. 적어 둔 시험만 기본표
--    (src/features/textbooks/exam-periods.ts)를 덮고, 안 적은 시험·학년도는 기본표 그대로다.
-- 🔑 학교 = 매칭 키(`school_key`, normalizeSchoolName — `산격중`·`대구 산격중학교`가 같은 키)로 묶고, 화면엔 `school_label`.
-- 🔴 부분 유니크(WHERE) 금지([[#113]]).
-- ⚠️ 앱은 이 표가 없어도 돈다([[#95]]) — 기본표로 계산하고 '학교별 내신기간' 저장만 잠긴다.
--
-- 롤백:
--   drop table if exists public.school_exam_periods;
set local statement_timeout = '60s';

create table if not exists public.school_exam_periods (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  school_key text not null check (length(school_key) between 1 and 60),
  school_label text not null check (length(school_label) between 1 and 60),
  school_year int not null check (school_year between 2020 and 2100),
  term text not null check (term in ('1-mid', '1-final', '2-mid', '2-final', '2-final-3')),
  from_date date not null,
  to_date date not null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint school_exam_periods_range check (from_date <= to_date),
  constraint school_exam_periods_slot_uniq unique (tenant_id, school_key, school_year, term)
);

comment on table public.school_exam_periods is
  '학교별 내신기간 — 학교 × 학년도 × 시험의 기간. 없으면 기본표(exam-periods.ts).';

drop trigger if exists school_exam_periods_set_updated_at on public.school_exam_periods;
create trigger school_exam_periods_set_updated_at before update on public.school_exam_periods
  for each row execute function public.tg_set_updated_at();

-- ── RLS — 읽기는 테넌트 전원, 쓰기는 service_role(서버 액션)만 ──
alter table public.school_exam_periods enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'school_exam_periods' and policyname = 'school_exam_periods_read'
  ) then
    create policy school_exam_periods_read on public.school_exam_periods
      for select using (tenant_id = public.auth_tenant_id());
  end if;
end $$;

notify pgrst, 'reload schema';
