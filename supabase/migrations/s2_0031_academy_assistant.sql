-- s2_0031_academy_assistant.sql — 학원 비서(원장 자연어 질의 챗봇)의 DB 쪽 · 2026-11-06
--
-- 원장 2026-11-06 *"모든 db에 접근가능한 챗봇을 만들어서 원장이상급이 챗봇에게 자연어로 질문하면 ai가 피드백해주는 학원 비서 챗봇"* ·
-- *"원장 자료니까 db를 하나도 빠짐없이 해당 지점 db를 조회하고 답변할 수 있어야함"* · *"온톨로지 기반의 답변을 해주면 좋을듯"*.
-- 설계 = docs/features/academy-assistant.md §2·§3.
--
-- 🔴 원장 승인 전 운영 적용 금지. 순서 = 이 SQL → 역할 비밀번호 설정(저장소 밖 · 아래 §2 끝 주석) → Vercel env ASSISTANT_DATABASE_URL → 앱 배포.
--    앱은 표·역할이 없으면 비서 버튼째 쉰다(표 없음 = enabled false · 연결 문자열 없음 = 연결 실패 안내).
-- 🔴 파일 번호는 임시(s2_0031) — 병합 때 main이 다음 빈 번호로 정한다.
--
-- 구성
--   §1 대화 저장 표(assistant_threads · assistant_messages) — 정책 0 · anon/authenticated 권한 회수(서버 키로만 읽고 쓴다)
--   §2 로그인 역할 aywa_assistant — 어떤 역할의 구성원도 아니다(올라갈 곳이 없다) · 쓰기 함수·쓰기 권한 0 · 시간 제한(조회는 앱이 늘 읽기 전용 거래로 연다)
--   §3 스키마 assistant(보기만) · assistant_private(묶기·정책·생성 함수) + 지점 묶기(DB 서명 증표 · service_role만 발급) + public 보안 정의자 11개 PUBLIC 실행권 회수
--   §4 정책 표 — 뺄 표 · 숨길 칸 · 가릴 칸(+ 이름 패턴: token·secret·password·p256dh·signature·_hash·auth)
--   §5 보기 생성 함수 refresh_views() + 바뀌었을 때만 다시 만드는 public.assistant_refresh_views_if_stale()(service_role)
--   §6 온톨로지 보기 onto_* — 앱의 세는 규칙과 같은 뜻(병합 원생 · 장부 정리 퇴원 · 시스템 일괄 퇴원 · 유효 출결 · 명단/수업 대상 · 담당 관계)
--   §7 생성 실행 · 사후 확인

begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ── §1 대화 저장 ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.assistant_threads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  level text not null default 'normal' check (level in ('low', 'normal', 'high')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists assistant_threads_owner_idx on public.assistant_threads (tenant_id, user_id, updated_at desc) where deleted_at is null;

create table if not exists public.assistant_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  thread_id uuid not null references public.assistant_threads(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  question text not null check (char_length(question) between 1 and 2000),
  level text not null check (level in ('low', 'normal', 'high')),
  status text not null default 'running' check (status in ('running', 'done', 'failed')),
  report jsonb,
  error text,
  queries jsonb not null default '[]'::jsonb,
  steps jsonb not null default '[]'::jsonb,
  usage jsonb not null default '[]'::jsonb,
  cancel_requested_at timestamptz,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists assistant_messages_thread_idx on public.assistant_messages (thread_id, created_at);
create index if not exists assistant_messages_owner_day_idx on public.assistant_messages (tenant_id, user_id, created_at desc);
-- 사람당 '도는 질문'은 하나 — 두 탭에서 동시에 물어도 하나만 들어간다(앱의 확인은 읽고-쓰기 사이가 비어 있다 · 적대 리뷰 2026-11-06).
-- '멈춤'을 누른 질문은 마무리 중이어도 새 질문을 막지 않는다. 함수가 죽어 남은 '도는 중'은 앱이 5분 뒤 실패로 닫는다(store.ts admission).
create unique index if not exists assistant_messages_one_running_idx on public.assistant_messages (tenant_id, user_id) where status = 'running' and cancel_requested_at is null;

alter table public.assistant_threads enable row level security;
alter table public.assistant_messages enable row level security;
revoke all on public.assistant_threads, public.assistant_messages from public, anon, authenticated;

-- ── §2 로그인 역할 ───────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'aywa_assistant') then
    create role aywa_assistant with login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls connection limit 4;
  end if;
end $$;
alter role aywa_assistant set search_path = assistant;
alter role aywa_assistant connection limit 4;
alter role aywa_assistant set statement_timeout = '8s';
alter role aywa_assistant set idle_in_transaction_session_timeout = '15s';
alter role aywa_assistant set lock_timeout = '2s';
alter role aywa_assistant set work_mem = '16MB';
-- 비밀번호는 저장소 밖에서(SQL 편집기에서 한 번): alter role aywa_assistant password '<새 비밀번호>';
-- 연결 문자열 = 거래 방식 풀러(6543) · 사용자 이름 aywa_assistant.<project ref> → Vercel env ASSISTANT_DATABASE_URL.

-- ── §3 스키마 · 지점 묶기 ────────────────────────────────────────────────────────────────────
create schema if not exists assistant;
create schema if not exists assistant_private;
revoke all on schema assistant, assistant_private from public, anon, authenticated, service_role;
grant usage on schema assistant, assistant_private to aywa_assistant;

-- 새 스키마의 함수는 PG 기본값으로 PUBLIC 실행권을 갖는다 — 미리 막는다(이후 만드는 함수도).
alter default privileges for role postgres in schema assistant, assistant_private revoke execute on functions from public;

-- 지점 묶기 = **DB가 서명한 증표**(쓰기 없음 · 거래 방식 풀러 6543에서도 같다 — 적대 리뷰 2026-11-06 2번):
--   앱 서버(service_role)가 public.assistant_issue_binding(지점)으로 증표를 받아 →
--   비서 연결의 읽기 전용 거래에서 set_config('assistant.binding', 증표, true) → AI 조회 → rollback.
-- · 증표 = '<지점 uuid>.<만료 epoch>.<HMAC-SHA256 hex>' · 서명 키는 assistant_private.signing_key(누구에게도 권한 없음 · 소유자 함수만 읽는다).
-- · 비서 역할(aywa_assistant)은 증표를 만들 수 없다 — 발급 함수 실행권이 없고, 쓰기 함수도 하나도 없다. set_config로 다른 값을 넣어도 서명이 맞지 않아 null.
-- · bound_tenant()가 null이면 모든 보기 0행(닫히는 쪽). 앱은 조회 전에 null이 아닌지 먼저 확인하고 아니면 멈춘다(0명으로 답하지 않게).
create table if not exists assistant_private.signing_key (
  id boolean primary key default true check (id),
  key bytea not null,
  created_at timestamptz not null default now()
);
insert into assistant_private.signing_key (id, key) values (true, extensions.gen_random_bytes(32)) on conflict (id) do nothing;
revoke all on assistant_private.signing_key from public, anon, authenticated, service_role, aywa_assistant;

create or replace function public.assistant_issue_binding(p_tenant uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_payload text;
begin
  if p_tenant is null or not exists (select 1 from public.tenants t where t.id = p_tenant) then
    raise exception 'assistant binding: 없는 지점' using errcode = '22023';
  end if;
  v_payload := p_tenant::text || '.' || extract(epoch from now() + interval '5 minutes')::bigint::text;
  return v_payload || '.' || encode(extensions.hmac(convert_to(v_payload, 'UTF8'), (select k.key from assistant_private.signing_key k where k.id), 'sha256'), 'hex');
end $$;

create or replace function assistant_private.bound_tenant() returns uuid
language plpgsql stable security definer parallel restricted set search_path = '' as $$
declare
  v_token text := current_setting('assistant.binding', true);
  v_parts text[];
begin
  if v_token is null or v_token = '' then return null; end if;
  v_parts := string_to_array(v_token, '.');
  if coalesce(array_length(v_parts, 1), 0) <> 3
     or v_parts[1] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or v_parts[2] !~ '^[0-9]{1,12}$'
     or v_parts[3] !~ '^[0-9a-f]{64}$' then
    return null;
  end if;
  if v_parts[2]::bigint < extract(epoch from now())::bigint then return null; end if;
  if encode(extensions.hmac(convert_to(v_parts[1] || '.' || v_parts[2], 'UTF8'), (select k.key from assistant_private.signing_key k where k.id), 'sha256'), 'hex') <> v_parts[3] then
    return null;
  end if;
  return v_parts[1]::uuid;
end $$;

-- 적대 리뷰 1번 — 모든 역할은 PUBLIC의 구성원이라, PUBLIC이 실행할 수 있는 public 보안 정의자 함수는 비서 역할도 부를 수 있다
-- (로그인 정보 설정값을 set_config로 위조하면 다른 지점 값을 돌려준다 — 앱 검사가 막지만 DB도 막는다).
-- 운영 확인 2026-11-06: 그런 함수 25개 = 트리거 14 + 일반 11, 모두 anon·authenticated·service_role·postgres에 명시 실행권이 따로 있다.
-- → **트리거가 아닌 것만** PUBLIC 실행권을 회수한다(명시 실행권은 그대로 — 앱·로그인 사용자 영향 없음 · 트리거는 실행권 없이도 발화한다).
-- 명시 실행권이 셋 다 있는 함수만 건드리고, 회수한 목록은 되돌리기를 위해 남긴다.
create table if not exists assistant_private.revoked_public_execute (fn regprocedure primary key, revoked_at timestamptz not null default now());
revoke all on assistant_private.revoked_public_execute from public, anon, authenticated, service_role, aywa_assistant;
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as fn
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef and p.prorettype <> 'trigger'::regtype
       and has_function_privilege('public', p.oid, 'execute')
       and exists (select 1 from aclexplode(p.proacl) a where a.privilege_type = 'EXECUTE' and a.grantee = 'anon'::regrole)
       and exists (select 1 from aclexplode(p.proacl) a where a.privilege_type = 'EXECUTE' and a.grantee = 'authenticated'::regrole)
       and exists (select 1 from aclexplode(p.proacl) a where a.privilege_type = 'EXECUTE' and a.grantee = 'service_role'::regrole)
  loop
    execute format('revoke execute on function %s from public', r.fn);
    insert into assistant_private.revoked_public_execute (fn) values (r.fn) on conflict (fn) do nothing;
  end loop;
end $$;

-- ── §4 정책 표 ───────────────────────────────────────────────────────────────────────────────
create table if not exists assistant_private.excluded_tables (table_name text primary key, reason text not null);
create table if not exists assistant_private.hidden_columns (
  table_name text not null, column_name text not null, reason text not null, primary key (table_name, column_name)
);
create table if not exists assistant_private.masked_columns (
  table_name text not null, column_name text not null, expr text not null, reason text not null, primary key (table_name, column_name)
);
create table if not exists assistant_private.state (
  id boolean primary key default true check (id), signature text, refreshed_at timestamptz, views integer
);
revoke all on assistant_private.excluded_tables, assistant_private.hidden_columns, assistant_private.masked_columns, assistant_private.state
  from public, anon, authenticated, service_role, aywa_assistant;

insert into assistant_private.excluded_tables (table_name, reason) values
  ('assistant_threads', '비서 자신의 대화 기록'),
  ('assistant_messages', '비서 자신의 대화 기록'),
  ('assistant_conversations', '폐지된 옛 대화형 비서의 대화(2026-09-03)'),
  ('operator_tenant_views', '운영 콘솔 지점 보기 기록 — 학원 자료가 아니라 운영자 기록')
on conflict (table_name) do update set reason = excluded.reason;

insert into assistant_private.hidden_columns (table_name, column_name, reason) values
  ('push_subscriptions', 'endpoint', '푸시 주소 = 알림을 보내는 열쇠')
on conflict (table_name, column_name) do update set reason = excluded.reason;

-- 가림식은 보기 안에서 `t.`로 원래 줄을 가리킨다(이 표는 이 마이그레이션·관리자만 쓴다).
insert into assistant_private.masked_columns (table_name, column_name, expr, reason) values
  ('tenant_settings', 'data', $m$t.data #- '{operations,seatPins}'$m$, '자리 출석부 PIN')
on conflict (table_name, column_name) do update set expr = excluded.expr, reason = excluded.reason;

-- 이름만으로 비밀 칸(열쇠)인 것 — 토큰·비밀·비밀번호·푸시 키·서명·해시. 'input_tokens'처럼 복수형 계측 칸은 걸리지 않는다.
create or replace function assistant_private.secret_column(p_name text) returns boolean
language sql immutable set search_path = '' as $$
  select p_name ~ '(^|_)(token|secret|password|passwd|p256dh|api_key|apikey|signature)($|_)'
      or p_name ~ '_hash$'
      or p_name = 'auth'
$$;

-- ── §5 보기 생성 ─────────────────────────────────────────────────────────────────────────────
-- 바뀜 판정 — public 표·칸(타입까지) + 정책 표 + 생성 규칙 판(v1). 하나라도 바뀌면 다시 만든다.
create or replace function assistant_private.schema_signature() returns text
language sql stable security definer set search_path = '' as $$
  select md5(
    coalesce((select string_agg(c.relname || '.' || a.attname || ':' || a.atttypid::text, ',' order by c.relname, a.attnum)
                from pg_class c
                join pg_namespace n on n.oid = c.relnamespace
                join pg_attribute a on a.attrelid = c.oid
               where n.nspname = 'public' and c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped), '')
    || '|' || coalesce((select string_agg(table_name, ',' order by table_name) from assistant_private.excluded_tables), '')
    || '|' || coalesce((select string_agg(table_name || '.' || column_name, ',' order by table_name, column_name) from assistant_private.hidden_columns), '')
    || '|' || coalesce((select string_agg(table_name || '.' || column_name || '=' || expr, ',' order by table_name, column_name) from assistant_private.masked_columns), '')
    || '|rules-v1'
  )
$$;

create or replace function assistant_private.create_ontology_views() returns void
language plpgsql security definer set search_path = '' as $$
begin
  -- 원생 한 사람 한 줄 + 세는 규칙(앱 판정과 같은 뜻 — src/features/assistant/catalog/ontology.ts).
  --  · 병합 = 메모 맨 앞 `중복 병합: <id>와 통합됨`(isMergedStudent) · 장부 정리 퇴원 = 끝난 수강 없음 + 정리 메모 + 사유 없음/기타(isBookkeepingOnlyExit)
  --  · 시스템 일괄 = 2026-07-10·07-03 + 끝난 수강 없음(isSystemBulkWithdrawal) · 퇴원 예정 = 퇴원일이 오늘(한국) 뒤
  if to_regclass('assistant.students') is not null and to_regclass('assistant.enrollments') is not null then
    execute $v$
      create view assistant.onto_students with (security_barrier = true) as
      with s as (
        select st.*,
               regexp_replace(coalesce(st.notes, ''), '^\s+', '') as notes_lead,
               exists (select 1 from assistant.enrollments e where e.student_id = st.id and e.end_date is not null) as has_ended_enrollment,
               nullif(st.withdrawal_metadata ->> 'reason', '') as w_reason,
               btrim(coalesce(st.withdrawal_metadata ->> 'memo', '')) as w_memo
          from assistant.students st
      ), k as (
        select s.*,
               s.notes_lead ~ '^중복 병합:\s*\S+와 통합됨' as merged,
               substring(s.notes_lead from '^중복 병합:\s*(\S+)와 통합됨') as merged_into_text,
               (s.w_reason is null or s.w_reason = 'other'
                  or s.w_reason not in ('dissatisfaction', 'grades', 'motivation', 'method', 'competitor', 'schedule', 'financial', 'career',
                                        'peers', 'illness', 'advised', 'relocation', 'graduated', 'other',
                                        'dissatisfied', 'unsatisfied', 'moved', 'graduate', 'cost', 'money'))
                 and (s.w_memo = '데이터 정리 일괄 퇴원' or s.w_memo like '수강 반 없음 일괄 퇴원 처리%') as cleanup_exit
          from s
      )
      select k.id,
             k.name,
             k.school,
             k.grade,
             k.gender,
             k.status::text as status,
             case k.status::text when 'prospect' then '예비' when 'consulted' then '상담완료' when 'enrolled' then '재원'
                                 when 'on_hold' then '휴원' when 'withdrawn' then '퇴원' else k.status::text end as status_label,
             k.enrolled_at,
             k.withdrawn_at as withdrawn_on,
             k.withdrawal_metadata ->> 'reason' as withdrawal_reason,
             coalesce(k.is_test, false) as is_test,
             k.merged as is_merged,
             case when k.merged_into_text ~ '^[0-9a-fA-F-]{36}$' then k.merged_into_text::uuid end as merged_into,
             k.has_ended_enrollment,
             case
               when k.withdrawn_at is null and k.status::text <> 'withdrawn' then null
               when not k.has_ended_enrollment and k.cleanup_exit then 'bookkeeping'
               when k.withdrawn_at > (now() at time zone 'Asia/Seoul')::date then 'scheduled'
               when not k.has_ended_enrollment and k.withdrawn_at in (date '2026-07-10', date '2026-07-03') then 'system_bulk'
               else 'real'
             end as exit_kind,
             (not coalesce(k.is_test, false) and not k.merged and not (not k.has_ended_enrollment and k.cleanup_exit)) as counted,
             k.created_at
        from k
    $v$;
  end if;

  -- 수강 + 반 과목 · 오늘(한국) 기준 진행 여부.
  if to_regclass('assistant.enrollments') is not null and to_regclass('assistant.classes') is not null then
    execute $v$
      create view assistant.onto_enrollments with (security_barrier = true) as
      select e.id,
             e.student_id,
             e.class_id,
             c.class_name,
             c.subject,
             c.teacher_id as homeroom_teacher_id,
             e.start_date,
             e.end_date,
             coalesce(e.on_hold, false) as on_hold,
             -- 명단(휴원 포함) = 시작했고 끝나지 않음 · 반이동으로 끝난 수강은 이동일에 이미 끝(반열림) · 일반 종료는 종료일까지(isEnrollmentOnRosterOn)
             (coalesce(e.start_date <= (now() at time zone 'Asia/Seoul')::date, true)
               and (e.end_date is null
                    or (coalesce(e.is_transferred, false) and e.end_date > (now() at time zone 'Asia/Seoul')::date)
                    or (not coalesce(e.is_transferred, false) and e.end_date >= (now() at time zone 'Asia/Seoul')::date))) as on_roster_today,
             -- 수업 대상 = 명단 − 휴원(isEnrollmentActiveOn)
             (not coalesce(e.on_hold, false)
               and coalesce(e.start_date <= (now() at time zone 'Asia/Seoul')::date, true)
               and (e.end_date is null
                    or (coalesce(e.is_transferred, false) and e.end_date > (now() at time zone 'Asia/Seoul')::date)
                    or (not coalesce(e.is_transferred, false) and e.end_date >= (now() at time zone 'Asia/Seoul')::date))) as active_today,
             coalesce(c.is_makeup_pool, false) as makeup_pool_class,
             e.withdrawal_reason,
             e.is_transferred,
             e.is_transferred_in
        from assistant.enrollments e
        left join assistant.classes c on c.id = e.class_id
    $v$;
  end if;

  -- 유효 출결 = 학생·반·수업일·교시마다 recorded_at이 가장 늦은 한 줄(같으면 id 큰 쪽) — effectiveAttendanceRecords와 같다(정정은 새 줄로 쌓인다).
  if to_regclass('assistant.attendance_records') is not null then
    execute $v$
      create view assistant.onto_attendance with (security_barrier = true) as
      select distinct on (a.student_id, a.class_id, a.session_date, a.slot_start)
             a.id, a.student_id, a.class_id, a.session_date, a.slot_start, a.status::text as status, a.taught_by, a.recorded_at,
             a.session_units, a.homework_required, a.homework_done, a.note
        from assistant.attendance_records a
       order by a.student_id, a.class_id, a.session_date, a.slot_start, a.recorded_at desc nulls last, a.id desc
    $v$;
  end if;

  -- 반 → 강사 '배정'(담임 = 지금 값 · 교시 담당 = 기간 · 임시 위임 = 기간). 🔴 배정이지 실제 수업 증거가 아니다(실제 = 출결 taught_by).
  if to_regclass('assistant.classes') is not null and to_regclass('assistant.class_schedules') is not null and to_regclass('assistant.class_delegations') is not null then
    execute $v$
      create view assistant.onto_class_teachers with (security_barrier = true) as
      select c.id as class_id, c.class_name, c.subject, c.teacher_id, 'homeroom'::text as role, '담임'::text as role_label,
             null::date as valid_from, null::date as valid_to, c.closed_at as class_closed_on
        from assistant.classes c
       where c.teacher_id is not null
      union all
      select distinct s.class_id, c.class_name, c.subject, s.teacher_id, 'scheduled', '교시 담당', s.valid_from, s.valid_to, c.closed_at
        from assistant.class_schedules s
        join assistant.classes c on c.id = s.class_id
       where s.teacher_id is not null
      union all
      select d.class_id, c.class_name, c.subject, d.delegate_user_id, 'delegated', '임시 위임', d.from_date, d.to_date, c.closed_at
        from assistant.class_delegations d
        join assistant.classes c on c.id = d.class_id
       where d.revoked_at is null
    $v$;
  end if;
end $$;

create or replace function assistant_private.refresh_views() returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '3s' as $$
declare
  r record;
  v_cols text;
  v_n integer := 0;
  v_sig text := assistant_private.schema_signature();
begin
  perform pg_advisory_xact_lock(hashtext('assistant_private.refresh_views'));
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'assistant' and c.relkind = 'v' loop
    execute format('drop view if exists assistant.%I cascade', r.relname);
  end loop;

  for r in
    select c.oid, c.relname,
           exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped) as has_tenant
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p')
       and not exists (select 1 from assistant_private.excluded_tables x where x.table_name = c.relname)
     order by c.relname
  loop
    -- 🔴 coalesce(format(...))로 쓰지 말 것 — format은 NULL을 빈 글자로 바꿔 '() as 칸'이 된다(로컬 시험에서 잡음).
    select string_agg(case when m.expr is not null then format('(%s) as %I', m.expr, a.attname) else format('t.%I', a.attname) end, ', ' order by a.attnum)
      into v_cols
      from pg_attribute a
      left join assistant_private.masked_columns m on m.table_name = r.relname and m.column_name = a.attname
     where a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped
       and not assistant_private.secret_column(a.attname)
       and not exists (select 1 from assistant_private.hidden_columns h where h.table_name = r.relname and h.column_name = a.attname);
    continue when v_cols is null;

    if r.has_tenant then
      execute format('create view assistant.%I with (security_barrier = true) as select %s from public.%I t where t.tenant_id = (select assistant_private.bound_tenant())',
                     r.relname, v_cols, r.relname);
    elsif r.relname = 'tenants' then
      execute format('create view assistant.tenants with (security_barrier = true) as select %s from public.tenants t where t.id = (select assistant_private.bound_tenant())', v_cols);
    elsif r.relname = 'consultation_ai_analysis' then
      execute format('create view assistant.consultation_ai_analysis with (security_barrier = true) as select %s from public.consultation_ai_analysis t
                       where exists (select 1 from public.enrollment_consultations p where p.id = t.consultation_id and p.tenant_id = (select assistant_private.bound_tenant()))', v_cols);
    elsif r.relname = 'notice_popup_translations' then
      execute format('create view assistant.notice_popup_translations with (security_barrier = true) as select %s from public.notice_popup_translations t
                       where exists (select 1 from public.notice_popups p where p.id = t.notice_id and p.tenant_id = (select assistant_private.bound_tenant()))', v_cols);
    else
      continue; -- 지점 칸도 지점 부모도 없는 표 = 학원 자료가 아니다(슈퍼관리자 · 연동 PC 배포 · 이관 표시 · 공용 설정)
    end if;
    v_n := v_n + 1;
  end loop;

  perform assistant_private.create_ontology_views();

  execute 'revoke all on all tables in schema assistant from public, anon, authenticated, service_role';
  execute 'grant select on all tables in schema assistant to aywa_assistant';

  insert into assistant_private.state (id, signature, refreshed_at, views) values (true, v_sig, now(), v_n)
  on conflict (id) do update set signature = excluded.signature, refreshed_at = excluded.refreshed_at, views = excluded.views;
  return jsonb_build_object('views', v_n, 'signature', v_sig);
end $$;

-- 앱(서버 키)이 질문마다 부른다 — 표·칸·정책이 바뀌었을 때만 다시 만든다(빠짐없이 = 새 표·새 칸이 다음 질문부터 보인다).
create or replace function public.assistant_refresh_views_if_stale() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_current text;
begin
  select s.signature into v_current from assistant_private.state s where s.id;
  if v_current is not distinct from assistant_private.schema_signature() then
    return jsonb_build_object('refreshed', false);
  end if;
  return assistant_private.refresh_views() || jsonb_build_object('refreshed', true);
end $$;

-- ── §7 권한 마무리 · 생성 실행 · 사후 확인 ───────────────────────────────────────────────────────
revoke all on all functions in schema assistant_private from public, anon, authenticated, service_role;
grant execute on function assistant_private.bound_tenant() to aywa_assistant;
revoke all on function public.assistant_issue_binding(uuid) from public, anon, authenticated;
grant execute on function public.assistant_issue_binding(uuid) to service_role;
revoke all on function public.assistant_refresh_views_if_stale() from public, anon, authenticated;
grant execute on function public.assistant_refresh_views_if_stale() to service_role;

select assistant_private.refresh_views();

do $$
declare
  v_views integer;
  v_outside integer;
  v_fns text;
begin
  select count(*) into v_views from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'assistant' and c.relkind = 'v';
  if v_views < 200 then raise exception 's2_0031 사후 확인: 보기가 %개뿐입니다', v_views; end if;
  -- aywa_assistant가 앱 자료 스키마(public · archive · auth · storage · vault · *_private)의 표를 읽을 수 없어야 한다.
  -- (스키마 사용 권한까지 있어야 실제로 읽힌다. extensions의 통계 보기처럼 확장이 PUBLIC에 연 것은 앱 자료가 아니라 여기서 보지 않는다 —
  --  그쪽은 앱 검사(sql-gate: assistant 보기만 · pg_ 이름 거절)가 막는다.)
  select count(*) into v_outside
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where (n.nspname in ('public', 'archive', 'auth', 'storage', 'vault') or n.nspname like '%\_private' escape '\')
     and c.relkind in ('r', 'p', 'v', 'm')
     and has_schema_privilege('aywa_assistant', n.oid, 'usage')
     and has_table_privilege('aywa_assistant', c.oid, 'select');
  if v_outside > 0 then raise exception 's2_0031 사후 확인: aywa_assistant가 assistant 밖 표 %개를 읽을 수 있습니다', v_outside; end if;
  if has_schema_privilege('authenticated', 'assistant', 'usage') or has_schema_privilege('anon', 'assistant', 'usage') then
    raise exception 's2_0031 사후 확인: assistant 스키마가 로그인 사용자에게 열려 있습니다';
  end if;
  if has_function_privilege('authenticated', 'public.assistant_refresh_views_if_stale()', 'execute') then
    raise exception 's2_0031 사후 확인: 보기 갱신 함수가 로그인 사용자에게 열려 있습니다';
  end if;
  if exists (select 1 from pg_auth_members m join pg_roles r on r.oid = m.member where r.rolname = 'aywa_assistant') then
    raise exception 's2_0031 사후 확인: aywa_assistant가 다른 역할의 구성원입니다';
  end if;
  -- 적대 리뷰 점검 쿼리 — 비서 역할이 부를 수 있는 보안 정의자 함수는 bound_tenant() 하나뿐이어야 한다(pg_catalog 밖 · 쓸 수 있는 스키마 안).
  select string_agg(p.oid::regprocedure::text, ', ') into v_fns
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname not in ('pg_catalog', 'information_schema')
     and p.prosecdef
     and p.oid <> 'assistant_private.bound_tenant()'::regprocedure
     and p.prorettype <> 'trigger'::regtype
     and has_schema_privilege('aywa_assistant', n.oid, 'usage')
     and has_function_privilege('aywa_assistant', p.oid, 'execute');
  if v_fns is not null then raise exception 's2_0031 사후 확인: aywa_assistant가 보안 정의자 함수를 부를 수 있습니다: %', v_fns; end if;
  if has_function_privilege('aywa_assistant', 'public.assistant_issue_binding(uuid)', 'execute') then
    raise exception 's2_0031 사후 확인: 비서 역할이 증표를 발급할 수 있습니다';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
