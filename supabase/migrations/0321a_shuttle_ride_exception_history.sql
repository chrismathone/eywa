-- 0321a — 셔틀 '그날만 변경'(0229a)을 **학부모도** 바꾸고, 누가·언제·어떻게 바꿨는지 **이력 장부**에 남긴다.
--
-- 사용자(2026-09-29): *"학부모가 내용을 바꾸면 디비도 바뀌게"* + *"누가 언제 어떻게 수정했는지도 기록에 남기고 싶다"*.
--
-- 🔑 무엇이 바뀌나
--    ① `shuttle_ride_exceptions`에 **마지막으로 바꾼 사람** — `actor_kind`(staff|parent|system) · `actor_name`
--       · `parent_account_id`. `created_by`는 직원 표(`public.users`)만 가리켜서 학부모를 적을 수 없었다(0320a:
--       학부모는 직원 표에 없다).
--    ② `shuttle_ride_exception_history` — **추가만 되는 장부**. 생성·변경·취소마다 한 줄, 전/후 자리를
--       **글자로 스냅샷**한다(노선 칸이 나중에 지워져도 "1호차 1회차 · 침산초 후문"이 남는다).
--    ③ 트리거가 장부를 쓴다 — 앱이 기록을 깜빡해도, 스크립트로 고쳐도 **빠지지 않는다**.
--       (감사로그 `logAction`은 best-effort라 실패하면 조용히 빠진다 — 그래서 장부는 DB가 직접 쓴다.)
--
-- 🔴 취소는 **지금처럼 행을 지운다**(소프트 삭제로 바꾸지 않는다) — 직원 화면 조회 여러 곳이 "행 있음 = 적용"으로
--    읽고 있어, 삭제 표시로 바꾸면 그 조회를 전부 고쳐야 하고 하나라도 빠지면 취소된 변경이 살아난다.
--    대신 **누가 지웠는지**를 트리거가 알 수 있게 취소는 함수 `cancel_shuttle_ride_exception`으로만 한다
--    (함수가 같은 트랜잭션 안에서 행위자를 `set_config`로 넘긴다). 함수를 거치지 않은 삭제(노선 칸·학생 삭제
--    cascade 등)는 행위자 '자동 정리'로 남는다 — 사람을 지어내지 않는다.
--
-- ⚠️ 장부에는 FK를 걸지 않는다 — 학생·노선 칸이 지워지는 **cascade 도중**에 트리거가 장부를 쓰는데, 그때
--    지워지는 행을 FK로 가리키면 삭제 자체가 실패한다. 이름·자리는 글자 스냅샷으로 남긴다.
--
-- 읽기 RLS = 테넌트 직원 전원(0229a와 같은 모양). 쓰기 정책 없음 — 트리거·service_role만 쓴다.
-- 학부모 화면은 service_role로 **자기 아이 것만** 읽는다(parent-ride-data.ts).
--
-- 롤백:
--   drop trigger if exists tg_shuttle_ride_exception_history on public.shuttle_ride_exceptions;
--   drop function if exists public.tg_shuttle_ride_exception_history();
--   drop function if exists public.cancel_shuttle_ride_exception(uuid, uuid, text, uuid, text);
--   drop function if exists public.shuttle_ride_exception_label(text, uuid);
--   drop table if exists public.shuttle_ride_exception_history;
--   alter table public.shuttle_ride_exceptions drop column if exists actor_kind,
--     drop column if exists actor_name, drop column if exists parent_account_id;
set local statement_timeout = '60s';

-- ① 마지막으로 바꾼 사람 ───────────────────────────────────────────────────────────
alter table public.shuttle_ride_exceptions
  add column if not exists actor_kind text not null default 'staff',
  add column if not exists actor_name text,
  add column if not exists parent_account_id uuid references public.parent_accounts(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'shuttle_ride_exceptions_actor_kind') then
    alter table public.shuttle_ride_exceptions
      add constraint shuttle_ride_exceptions_actor_kind check (actor_kind in ('staff', 'parent', 'system'));
  end if;
end $$;

-- 기존 행의 이름을 채운다(직원이 건 것뿐이다). ⚠️ 트리거를 만들기 **전에** — 뒤에 하면 이 갱신이 장부에 '변경'으로 쌓인다.
update public.shuttle_ride_exceptions e
   set actor_name = u.display_name
  from public.users u
 where u.id = e.created_by and e.actor_name is null;

-- ② 이력 장부 ─────────────────────────────────────────────────────────────────────
create table if not exists public.shuttle_ride_exception_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  exception_id uuid not null,
  on_date date not null,
  student_id uuid not null,
  student_name text,
  kind text not null,          -- skip | add
  io_kind text not null,       -- in | out
  op text not null constraint shuttle_ride_exception_history_op check (op in ('create', 'update', 'cancel')),
  before_run_stop_id uuid,
  after_run_stop_id uuid,
  -- "1호차 1회차 · 침산초 후문" / "이날 안 탐". null = 평소대로(변경 없음).
  before_label text,
  after_label text,
  memo text,
  actor_kind text not null,    -- staff | parent | system
  actor_id uuid,               -- staff = users.id, parent = parent_accounts.id
  actor_name text,
  -- clock_timestamp — now()는 트랜잭션 시작 시각이라 한 트랜잭션의 여러 줄이 같은 시각이 돼 순서를 잃는다.
  created_at timestamptz not null default clock_timestamp()
);

comment on table public.shuttle_ride_exception_history is
  '셔틀 그날만 변경(0229a)의 이력 장부(0321a) — 트리거가 생성·변경·취소마다 한 줄. 추가만 된다(수정·삭제 금지).';

create index if not exists shuttle_ride_exception_history_student_idx
  on public.shuttle_ride_exception_history (tenant_id, student_id, on_date);
create index if not exists shuttle_ride_exception_history_recent_idx
  on public.shuttle_ride_exception_history (tenant_id, created_at desc);

alter table public.shuttle_ride_exception_history enable row level security;
drop policy if exists shuttle_ride_exception_history_tenant_read on public.shuttle_ride_exception_history;
create policy shuttle_ride_exception_history_tenant_read on public.shuttle_ride_exception_history
  for select using (tenant_id = public.auth_tenant_id());

-- 추가만 — 장부를 고치거나 지우는 건 service_role이라도 막는다.
create or replace function public.tg_shuttle_ride_exception_history_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception '셔틀 변경 이력은 수정하거나 지울 수 없습니다';
end;
$$;

drop trigger if exists tg_shuttle_ride_exception_history_append_only on public.shuttle_ride_exception_history;
create trigger tg_shuttle_ride_exception_history_append_only
  before update or delete on public.shuttle_ride_exception_history
  for each row execute function public.tg_shuttle_ride_exception_history_append_only();

-- 자리 글자 — add면 "1호차 1회차 · 침산초 후문", skip이면 "이날 안 탐". 노선 칸이 이미 없으면 null.
create or replace function public.shuttle_ride_exception_label(p_kind text, p_run_stop_id uuid)
returns text
language sql
stable
set search_path = public
as $$
  select case
    when p_kind = 'skip' then '이날 안 탐'
    else (
      select concat_ws(' · ',
               nullif(concat_ws(' ', v.name, coalesce(nullif(btrim(r.label), ''), r.run_no || '회차')), ''),
               case rs.kind when 'depart' then '학원 출발' when 'arrive' then '학원 도착' else coalesce(s.name, '정류장') end)
        from public.shuttle_run_stops rs
        join public.shuttle_runs r on r.id = rs.run_id
        left join public.shuttle_vehicles v on v.id = r.vehicle_id
        left join public.shuttle_stops s on s.id = rs.stop_id
       where rs.id = p_run_stop_id
    )
  end
$$;

-- ③ 장부 트리거 ───────────────────────────────────────────────────────────────────
create or replace function public.tg_shuttle_ride_exception_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student text;
begin
  if tg_op = 'DELETE' then
    select name into v_student from public.students where id = old.student_id;
    insert into public.shuttle_ride_exception_history (
      tenant_id, exception_id, on_date, student_id, student_name, kind, io_kind, op,
      before_run_stop_id, after_run_stop_id, before_label, after_label, memo,
      actor_kind, actor_id, actor_name
    ) values (
      old.tenant_id, old.id, old.on_date, old.student_id, v_student, old.kind, old.io_kind, 'cancel',
      old.run_stop_id, null, public.shuttle_ride_exception_label(old.kind, old.run_stop_id), null, old.memo,
      coalesce(nullif(current_setting('eywa.actor_kind', true), ''), 'system'),
      nullif(current_setting('eywa.actor_id', true), '')::uuid,
      coalesce(nullif(current_setting('eywa.actor_name', true), ''), '자동 정리(노선·학생 삭제 등)')
    );
    return old;
  end if;

  -- 같은 값으로 다시 저장(upsert)한 것은 변경이 아니다 — 장부를 부풀리지 않는다.
  if tg_op = 'UPDATE'
     and old.run_stop_id is not distinct from new.run_stop_id
     and old.memo is not distinct from new.memo then
    return new;
  end if;

  select name into v_student from public.students where id = new.student_id;
  insert into public.shuttle_ride_exception_history (
    tenant_id, exception_id, on_date, student_id, student_name, kind, io_kind, op,
    before_run_stop_id, after_run_stop_id, before_label, after_label, memo,
    actor_kind, actor_id, actor_name
  ) values (
    new.tenant_id, new.id, new.on_date, new.student_id, v_student, new.kind, new.io_kind,
    case tg_op when 'INSERT' then 'create' else 'update' end,
    case tg_op when 'UPDATE' then old.run_stop_id end,
    new.run_stop_id,
    case tg_op when 'UPDATE' then public.shuttle_ride_exception_label(old.kind, old.run_stop_id) end,
    public.shuttle_ride_exception_label(new.kind, new.run_stop_id),
    new.memo,
    new.actor_kind,
    case new.actor_kind when 'parent' then new.parent_account_id else new.created_by end,
    new.actor_name
  );
  return new;
end;
$$;

drop trigger if exists tg_shuttle_ride_exception_history on public.shuttle_ride_exceptions;
create trigger tg_shuttle_ride_exception_history
  after insert or update or delete on public.shuttle_ride_exceptions
  for each row execute function public.tg_shuttle_ride_exception_history();

-- ④ 취소 함수 — 행위자를 같은 트랜잭션에 실어 지운다(트리거가 읽는다). service_role 전용.
create or replace function public.cancel_shuttle_ride_exception(
  p_tenant_id uuid,
  p_id uuid,
  p_actor_kind text,
  p_actor_id uuid,
  p_actor_name text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_actor_kind not in ('staff', 'parent', 'system') then
    raise exception 'bad actor kind %', p_actor_kind;
  end if;
  perform set_config('eywa.actor_kind', p_actor_kind, true);
  perform set_config('eywa.actor_id', coalesce(p_actor_id::text, ''), true);
  perform set_config('eywa.actor_name', coalesce(p_actor_name, ''), true);
  delete from public.shuttle_ride_exceptions where id = p_id and tenant_id = p_tenant_id;
  return found;
end;
$$;

revoke all on function public.cancel_shuttle_ride_exception(uuid, uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_shuttle_ride_exception(uuid, uuid, text, uuid, text) to service_role;

notify pgrst, 'reload schema';
