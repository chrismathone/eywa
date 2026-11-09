-- s2_0036_academy_assistant_advice.sql — 학원 비서: 비서 의견 기록 · 원장 처리 · 확인 지표 기준값(제안 → 결과 → 학습 1단계) · 2026-11-09
--
-- 원장 2026-11-06 *"단순히 분석한 해결책을 제안하는데 그치지 않고 그 해결책이 어떤 결과를 가져왔는지에 대한 결과 피드백까지
-- 할 수 있게해서 지속적인 학습이 이루어지도록 설계할 것."* · 2026-11-09 1단계 범위 = '기록 + 처리 + 확인 지표'.
-- 설계 = docs/features/academy-assistant.md §7-5. 재측정(크론)·판정·학습은 다음 단계(이 표의 칸을 쓴다 — 표를 다시 만들지 않는다).
--
-- 🔴 원장 승인 전 운영 적용 금지. 순서 = 이 SQL → 앱 배포(새 앱이 이 표에 쓴다 — 앱을 먼저 올려도 답은 산다: 의견 줄 저장이 실패하면
--    처리 단추만 안 보인다(ask.ts)). 되돌리기 = scripts/_oneoff/revert-s2_0036-academy-assistant-advice.sql(앱 먼저 되돌린 뒤).
--
-- 만드는 것
--   ① assistant_advice — 답(assistant_messages) 하나의 비서 의견 항목마다 한 줄: 할 일·까닭·주제 · 확인 지표(조회문 틀·단위·좋아지는 쪽·
--      기간·며칠 뒤 다시 잴지) 또는 잴 수 없는 까닭 · 기준값(답할 때 같은 읽기 전용 실행기로 잰 값) · 원장 처리(채택·완료·보류·안 함).
--   ② assistant_advice_events — 처리 이력(누가 · 언제 · 무엇에서 무엇으로 · 메모).
--   두 표 모두 비서가 조회하는 보기에서 뺀다(assistant_threads·messages와 같은 원칙 — 비서 자신의 기록 · 조회문 원문이 들어 있다).
--   🔴 제외 목록에 먼저 넣는다(같은 거래) — 표가 먼저 생기면 다음 보기 갱신 때 보기가 만들어진다.
-- 권한: RLS 켬 · 정책 0 · public/anon/authenticated 회수 — 앱의 service_role(관리자 연결)만 읽고 쓴다(앱이 원장 관문을 지난 뒤).
-- 지킴 트리거: 지점·답·대화가 서로 맞는지 · 묻는 사람·처리한 사람이 그 지점 직원인지 · 한 번 정한 이름표(지점·답·순번·묻는 사람)는 못 바꾼다 ·
--   처리 시각(status_at)은 DB 시계로 적는다.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- ── §0 비서 보기에서 빼기(표보다 먼저) ─────────────────────────────────────────────────────
insert into assistant_private.excluded_tables (table_name, reason) values
  ('assistant_advice', '비서 자신의 의견 기록 — 확인 지표 조회문 원문이 들어 있다'),
  ('assistant_advice_events', '비서 의견 처리 이력')
on conflict (table_name) do update set reason = excluded.reason;

-- ── §1 비서 의견 ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.assistant_advice (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  message_id uuid not null references public.assistant_messages(id) on delete cascade,
  thread_id uuid not null references public.assistant_threads(id) on delete cascade,
  asked_by uuid not null references public.users(id) on delete cascade,
  item_no smallint not null check (item_no between 0 and 4),
  action text not null check (char_length(action) between 1 and 400),
  why text not null check (char_length(why) between 1 and 800),
  topic text not null default 'other'
    check (topic in ('attendance', 'homework', 'grades', 'retention', 'enrollment', 'billing', 'teacher', 'class_ops', 'parent', 'cost', 'data', 'other')),
  method text check (method in ('call', 'message', 'meeting', 'schedule', 'staffing', 'incentive', 'process', 'check', 'other')),
  -- 확인 지표 — 조회문 틀은 {{시작}}(포함)·{{끝}}(제외) 날짜 자리를 그대로 담는다(다시 잴 때 그 기간으로 채운다).
  check_label text check (char_length(check_label) between 1 and 120),
  check_sql text check (char_length(check_sql) between 1 and 8000),
  check_unit text check (check_unit in ('percent', 'count', 'won', 'number')),
  check_better text check (check_better in ('up', 'down')),
  window_days smallint check (window_days in (7, 14, 28)),
  check_after_days smallint check (check_after_days between 7 and 84),
  no_check_reason text check (char_length(no_check_reason) between 1 and 120),
  -- 기준값 — [baseline_from, baseline_to) 기간을 답할 때 잰 값(비율이면 표본 = 분모).
  baseline_from date,
  baseline_to date,
  baseline_value numeric,
  baseline_sample numeric check (baseline_sample is null or baseline_sample >= 0),
  baseline_at timestamptz,
  -- 재측정 상태(다음 단계의 크론이 쓴다) — none = 확인 지표 없음 · waiting = 다시 잴 날을 기다림 · measured · broken · stopped.
  measure_state text not null default 'none' check (measure_state in ('none', 'waiting', 'measured', 'broken', 'stopped')),
  next_check_on date,
  -- 원장 처리
  status text not null default 'open' check (status in ('open', 'adopted', 'done', 'on_hold', 'declined')),
  status_memo text check (char_length(status_memo) <= 500),
  status_by uuid references public.users(id) on delete set null,
  status_at timestamptz not null default now(),
  done_on date,
  self_rating text check (self_rating in ('good', 'meh', 'bad')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (message_id, item_no),
  -- 확인 지표는 한 벌로(다 있거나 다 없거나) · 확인 지표와 잴 수 없는 까닭 중 정확히 하나.
  constraint assistant_advice_check_complete check (
    (check_sql is null and check_label is null and check_unit is null and check_better is null and window_days is null and check_after_days is null)
    or (check_sql is not null and check_label is not null and check_unit is not null and check_better is not null and window_days is not null and check_after_days is not null)
  ),
  constraint assistant_advice_check_or_reason check ((check_sql is null) <> (no_check_reason is null)),
  constraint assistant_advice_window_order check (check_after_days is null or check_after_days >= window_days),
  constraint assistant_advice_baseline_window check (baseline_from is null or (baseline_to is not null and baseline_from < baseline_to)),
  constraint assistant_advice_waiting_has_date check (measure_state <> 'waiting' or next_check_on is not null)
);
create index if not exists assistant_advice_tenant_check_idx on public.assistant_advice (tenant_id, next_check_on) where measure_state = 'waiting';
create index if not exists assistant_advice_thread_idx on public.assistant_advice (thread_id);

-- ── §2 처리 이력 ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.assistant_advice_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  advice_id uuid not null references public.assistant_advice(id) on delete cascade,
  actor_id uuid references public.users(id) on delete set null,
  from_status text not null check (from_status in ('open', 'adopted', 'done', 'on_hold', 'declined')),
  to_status text not null check (to_status in ('open', 'adopted', 'done', 'on_hold', 'declined')),
  memo text check (char_length(memo) <= 500),
  done_on date,
  self_rating text check (self_rating in ('good', 'meh', 'bad')),
  created_at timestamptz not null default now()
);
create index if not exists assistant_advice_events_advice_idx on public.assistant_advice_events (advice_id, created_at);

alter table public.assistant_advice enable row level security;
alter table public.assistant_advice_events enable row level security;
revoke all on public.assistant_advice, public.assistant_advice_events from public, anon, authenticated;
grant select, insert, update, delete on public.assistant_advice, public.assistant_advice_events to service_role;

-- ── §3 지킴 트리거 ───────────────────────────────────────────────────────────────────────────
create or replace function assistant_private.advice_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (new.tenant_id, new.message_id, new.thread_id, new.item_no, new.asked_by)
       is distinct from (old.tenant_id, old.message_id, old.thread_id, old.item_no, old.asked_by) then
    raise exception '비서 의견의 지점·답·순번·묻는 사람은 바꿀 수 없습니다' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.assistant_messages m
                    where m.id = new.message_id and m.tenant_id = new.tenant_id and m.thread_id = new.thread_id and m.user_id = new.asked_by) then
      raise exception '비서 의견의 답·대화·지점·묻는 사람이 맞지 않습니다' using errcode = '42501';
    end if;
    if new.status <> 'open' then
      raise exception '새 비서 의견은 처리 전(open)으로만 만듭니다' using errcode = '42501';
    end if;
  end if;
  if new.status_by is not null and new.status_by is distinct from old.status_by
     and not exists (select 1 from public.users u where u.id = new.status_by and u.tenant_id = new.tenant_id) then
    raise exception '처리한 사람이 이 지점 직원이 아닙니다' using errcode = '42501';
  end if;
  -- 처리 시각은 DB 시계로 — 앱이 status_at을 바꿔 보내면(처리했다는 표시 · 낙관적 잠금의 새 값) 그 값 대신 now()
  -- (서버마다 시계가 달라도 처리 순서가 맞게 · 다음 단계가 이 시각으로 '처리 뒤 측정'을 가른다 · 적대 리뷰 2026-11-09).
  if tg_op = 'UPDATE' and new.status_at is distinct from old.status_at then
    new.status_at := now();
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists assistant_advice_guard on public.assistant_advice;
create trigger assistant_advice_guard before insert or update on public.assistant_advice
for each row execute function assistant_private.advice_guard();

create or replace function assistant_private.advice_event_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op <> 'INSERT' then
    raise exception '처리 이력은 고치지 않고 새 줄로 남깁니다' using errcode = '42501';
  end if;
  if not exists (select 1 from public.assistant_advice a where a.id = new.advice_id and a.tenant_id = new.tenant_id) then
    raise exception '처리 이력의 지점이 의견과 맞지 않습니다' using errcode = '42501';
  end if;
  if new.actor_id is not null and not exists (select 1 from public.users u where u.id = new.actor_id and u.tenant_id = new.tenant_id) then
    raise exception '처리한 사람이 이 지점 직원이 아닙니다' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists assistant_advice_events_guard on public.assistant_advice_events;
create trigger assistant_advice_events_guard before insert or update on public.assistant_advice_events
for each row execute function assistant_private.advice_event_guard();

revoke all on function assistant_private.advice_guard(), assistant_private.advice_event_guard() from public, anon, authenticated, service_role;

-- ── §4 사후 확인 ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from assistant_private.excluded_tables where table_name in ('assistant_advice', 'assistant_advice_events')) <> 2 then
    raise exception 's2_0036: 비서 보기 제외 목록에 새 표가 없습니다';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.assistant_advice'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.assistant_advice_events'::regclass) then
    raise exception 's2_0036: RLS가 켜지지 않았습니다';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('assistant_advice', 'assistant_advice_events')) then
    raise exception 's2_0036: 정책이 있으면 안 됩니다(service_role만 쓴다)';
  end if;
  if has_table_privilege('anon', 'public.assistant_advice', 'select') or has_table_privilege('authenticated', 'public.assistant_advice', 'select')
     or has_table_privilege('anon', 'public.assistant_advice_events', 'select') or has_table_privilege('authenticated', 'public.assistant_advice_events', 'select') then
    raise exception 's2_0036: 로그인·비로그인 사용자가 새 표를 읽을 수 있습니다';
  end if;
  if not has_table_privilege('service_role', 'public.assistant_advice', 'insert')
     or not has_table_privilege('service_role', 'public.assistant_advice_events', 'insert') then
    raise exception 's2_0036: 앱(service_role)이 새 표에 쓸 수 없습니다';
  end if;
  if exists (select 1 from pg_roles where rolname = 'aywa_assistant')
     and (has_table_privilege('aywa_assistant', 'public.assistant_advice', 'select') or has_table_privilege('aywa_assistant', 'public.assistant_advice_events', 'select')) then
    raise exception 's2_0036: 비서 조회 역할이 새 표를 읽을 수 있습니다';
  end if;
  if to_regclass('assistant.assistant_advice') is not null or to_regclass('assistant.assistant_advice_events') is not null then
    raise exception 's2_0036: 비서 보기에 새 표가 있습니다';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
