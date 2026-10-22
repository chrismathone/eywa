-- 원생 기여도. 적용은 원장 승인 뒤, 앱 배포보다 먼저. 점수는 저장하지 않는다.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
create table if not exists public.student_contribution_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  config jsonb not null default '{}' check (jsonb_typeof(config) = 'object'),
  revision bigint not null default 0,
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  history_ready boolean not null default false,
  refreshed_at timestamptz,
  referral_review jsonb,
  refresh_token uuid,
  refresh_started_at timestamptz
);
create table if not exists public.student_contribution_months (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  month text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  raws jsonb not null check (jsonb_typeof(raws) = 'object'),
  correction jsonb not null check (jsonb_typeof(correction) = 'object'),
  -- 원본별 근거·관계·자료 범위. 목록은 이 칸을 읽지 않는다.
  payload jsonb not null default '{}' check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 2097152),
  -- 메이크에듀 원자료를 처음 한 번 학생×월로 접은 캐시(점수 없음).
  historical jsonb,
  unavailable text[] not null default '{}',
  closed_at timestamptz,
  reconstructed boolean not null default false,
  computed_at timestamptz not null,
  primary key (tenant_id, student_id, month)
);
create index if not exists student_contribution_months_tenant_month_idx on public.student_contribution_months(tenant_id, month);
create table if not exists public.student_positive_signals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  source text not null check (source in ('parent', 'teacher')),
  source_id uuid not null,
  source_hash text not null,
  occurred_on date not null,
  author_label text,
  classification text not null check (classification in ('observed', 'unsupported_praise', 'thanks', 'other')),
  evidence text not null default '' check (length(evidence) <= 300),
  method text not null check (method in ('rule', 'ai')),
  model_label text,
  judged_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid references public.users(id) on delete set null,
  cancel_reason text,
  rejudge_requested_at timestamptz,
  unique (tenant_id, source, source_id)
);
create index if not exists student_positive_signals_student_idx on public.student_positive_signals(tenant_id, student_id, occurred_on);
alter table public.student_contribution_settings enable row level security;
alter table public.student_contribution_months enable row level security;
alter table public.student_positive_signals enable row level security;
revoke all on public.student_contribution_settings, public.student_contribution_months, public.student_positive_signals from public, anon, authenticated;
grant all on public.student_contribution_settings, public.student_contribution_months, public.student_positive_signals to service_role;
-- 정책 0개. 모든 접근은 서버의 두 권한 게이트 + tenant_id 조건을 지난다.
create or replace function public.guard_student_contribution_row() returns trigger
language plpgsql set search_path = public as $$
declare metric text; part jsonb;
begin
  if tg_op in ('UPDATE', 'DELETE') and tg_table_name = 'student_contribution_months' then
    if old.closed_at is not null and pg_trigger_depth() = 1 then
      raise exception '마감한 달의 원래 수치는 바꿀 수 없습니다' using errcode = 'P0001';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if not exists(select 1 from public.students where id = new.student_id and tenant_id = new.tenant_id) then
    raise exception '원생의 학원 정보를 확인해 주세요';
  end if;
  if tg_table_name = 'student_contribution_months' then
    foreach part in array array[new.raws, new.correction] loop
      foreach metric in array array['referralConsult','referralStarted','tuitionWon','subjectMonths','tenureYears',
        'perfectMonths','videoMonths','examMonths','parentPositiveMonths','teacherPositiveMonths'] loop
        if not (part ? metric) or jsonb_typeof(part->metric) <> 'number'
          or (part->>metric) !~ '^-?[0-9]+$' or abs((part->>metric)::numeric) > 9007199254740991 then
          raise exception '기여도 원자료의 수치를 확인해 주세요';
        end if;
      end loop;
    end loop;
  end if;
  return new;
end; $$;
drop trigger if exists student_contribution_months_guard on public.student_contribution_months;
create trigger student_contribution_months_guard before insert or update or delete on public.student_contribution_months
  for each row execute function public.guard_student_contribution_row();
drop trigger if exists student_positive_signals_guard on public.student_positive_signals;
create trigger student_positive_signals_guard before insert or update on public.student_positive_signals
  for each row execute function public.guard_student_contribution_row();
comment on table public.student_contribution_months is '학생×월 원래 수치. 현재 배점으로 조회 시 계산. 마감 후 수정은 열린 달 정정으로 반영.';
comment on table public.student_positive_signals is '학생의 관찰된 긍정 신호 판정. 원문은 기존 표에 보존하며 원문 해시로 수정·삭제를 감지.';
commit;
