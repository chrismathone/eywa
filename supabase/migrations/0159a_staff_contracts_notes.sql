-- 0159a_staff_contracts_notes.sql (손수 alpha)
-- 계약 히스토리에 **기간 없는 줄도** 담는다(원장 지적 2026-07-31: "히스토리가 한 줄만 들어가 있음").
--
-- 0149a는 '기간이 있는 계약'만 담게 만들었는데, 시트 '계약조건 history' 셀에는 기간 없는 줄이 섞여 있고
-- 그게 버려졌다(전수 58줄). 버려진 것 중엔 입사·재입사·퇴사 기록뿐 아니라 **인센티브 수당 조항**,
-- **부서 이전**, 시급 전환, 그리고 연도 오타로 기간 인식이 안 된 **실제 계약 한 건**까지 있었다.
--
--   kind='contract' — 기간이 있는 계약. 차수(seq)를 받는다.
--   kind='note'     — 그 밖의 모든 줄(원문 그대로 terms에). seq=0, 날짜는 있으면 start_date에만.
-- line_no = 시트 셀에서의 줄 순서(0=맨 위) — 날짜 없는 줄도 원문 순서를 잃지 않게.

alter table public.staff_contracts alter column start_date drop not null;
alter table public.staff_contracts alter column end_date drop not null;

alter table public.staff_contracts drop constraint if exists staff_contracts_period_check;
alter table public.staff_contracts add constraint staff_contracts_period_check
  check (start_date is null or end_date is null or end_date > start_date);

alter table public.staff_contracts
  add column if not exists kind text not null default 'contract',
  add column if not exists line_no integer;

alter table public.staff_contracts drop constraint if exists staff_contracts_kind_check;
alter table public.staff_contracts add constraint staff_contracts_kind_check
  check (kind in ('contract', 'note'));

-- 차수 유일성은 **계약에만** — note는 전부 seq=0이라 유일 제약을 그대로 두면 두 줄째에서 막힌다.
drop index if exists staff_contracts_user_seq_idx;
create unique index if not exists staff_contracts_user_seq_idx
  on public.staff_contracts (tenant_id, user_id, seq)
  where kind = 'contract';
