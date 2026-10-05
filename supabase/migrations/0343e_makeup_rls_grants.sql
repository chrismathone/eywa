-- 0343e — 보강 원장 5/5: RLS · 권한 회수 · 행 보호 트리거
--
-- 🔴 새 표 14개는 **RPC로만** 다룬다.
--    · anon·authenticated: 표 권한 0(직접 SELECT도 안 된다). 읽기는 범위를 DB가 강제하는 읽기 RPC(0348a·0348b).
--    · service_role: SELECT만. 서버 어댑터가 앱 게이트를 지난 뒤 tenant_id를 명시해 읽는 용도다.
--      INSERT/UPDATE/DELETE는 회수한다 — 관리자 클라이언트로 원장을 직접 고치는 길을 두지 않는다.
--    · RLS는 켜되 정책은 만들지 않는다(권한이 없으니 "에러 없이 0행"[[#104]]이 아니라 권한 오류로 드러난다).
--    ⚠️ Supabase는 public 새 표에 기본 권한을 자동으로 주므로 **명시 회수**가 필요하다.
-- 🔴 핵심 표의 INSERT/UPDATE는 명령 안(`makeup_private.in_command()`)에서만 통과한다 — 권한이 실수로
--    다시 열려도 명령 밖 쓰기는 트리거가 거절한다(#77). 대사·반영 작업·이벤트는 정규 저장 쪽 관측
--    트리거(0349b)도 쓰므로 이 제한에서 뺀다.
-- 🔴 삭제 금지: 원장 행은 지우지 않는다. 학원(tenant) 자체가 지워질 때의 연쇄 삭제만 통과한다.
-- 멱등: create or replace + drop trigger if exists.

-- 명령 안에서만 참 — 0347a가 명령 시작 때 이 트랜잭션의 id를 적어 둔다(트랜잭션이 끝나면 사라진다).
create or replace function makeup_private.in_command() returns boolean
language sql stable set search_path = pg_catalog as $$
  select coalesce(current_setting('makeup.ctx', true), '') <> ''
     and current_setting('makeup.ctx', true) = coalesce(pg_current_xact_id_if_assigned()::text, 'none')
$$;

-- 바깥 행(직원·강의실·출결·보고서)이 지워져 **연결 칸만 비는** 변경인가(FK on delete set null).
-- 🔴 이 변경은 막지 않는다 — 막으면 원장이 직원 삭제·출결 삭제 같은 기존 흐름을 거절하게 된다.
-- 🔴 단, 통과하는 길은 하나뿐이다(allow_unlink): 참조 무결성 동작이 일으킨 변경이고(트리거 깊이 2 이상), 비워진 칸이 가리키던
--    바깥 행이 **실제로 없어졌을 때**. 연결 칸만 비우는 직접 UPDATE는 명령 밖에서 통과하지 못한다.
create or replace function makeup_private.is_unlink_only(p_old jsonb, p_new jsonb) returns boolean
language sql immutable set search_path = pg_catalog as $$
  with refs as (select array['owner_id', 'created_by', 'teacher_id', 'classroom_id', 'attendance_record_id', 'report_id',
    'actual_teacher_id', 'recorded_by', 'submitted_by', 'verified_by', 'decided_by', 'approved_by', 'actor_id',
    'resolved_by'] as cols)
  -- 비교에서 빼는 칸: 연결 칸 + 트리거가 채우는 칸(생성열은 BEFORE 트리거의 NEW에서 아직 비어 있다).
  select (p_new - cols - array['updated_at', 'revision', 'outstanding_minutes'])
         = (p_old - cols - array['updated_at', 'revision', 'outstanding_minutes'])
     and not exists (select 1 from unnest(cols) c
                      where p_new -> c is distinct from p_old -> c and p_new -> c <> 'null'::jsonb)
  from refs
$$;

create or replace function makeup_private.unlink_is_real(p_old jsonb, p_new jsonb) returns boolean
language sql security definer set search_path = public, pg_temp as $$
  select not exists (
    select 1 from (values ('owner_id', 'u'), ('created_by', 'u'), ('teacher_id', 'u'), ('actual_teacher_id', 'u'), ('recorded_by', 'u'),
        ('submitted_by', 'u'), ('verified_by', 'u'), ('decided_by', 'u'), ('approved_by', 'u'), ('actor_id', 'u'), ('resolved_by', 'u'),
        ('classroom_id', 'r'), ('attendance_record_id', 'a'), ('report_id', 'l')) m(col, t)
     where p_old ->> m.col is not null and p_new ->> m.col is null
       and case m.t when 'u' then exists (select 1 from public.users x where x.id = (p_old ->> m.col)::uuid)
                    when 'r' then exists (select 1 from public.classrooms x where x.id = (p_old ->> m.col)::uuid)
                    when 'a' then exists (select 1 from public.attendance_records x where x.id = (p_old ->> m.col)::uuid)
                    else exists (select 1 from public.lesson_reports x where x.id = (p_old ->> m.col)::uuid) end)
$$;

create or replace function makeup_private.allow_unlink(p_old jsonb, p_new jsonb) returns boolean
language sql security definer set search_path = public, pg_temp as $$
  -- 직접 UPDATE = 깊이 1(이 표의 트리거만). 참조 무결성 동작이 일으킨 UPDATE = 깊이 2 이상(바깥 표의 RI 트리거 안).
  select pg_trigger_depth() > 1 and makeup_private.is_unlink_only(p_old, p_new) and makeup_private.unlink_is_real(p_old, p_new)
$$;

create or replace function makeup_private.tg_touch() returns trigger
language plpgsql security definer set search_path = pg_catalog as $$
begin
  if new.tenant_id is distinct from old.tenant_id or new.id is distinct from old.id then
    raise exception '보강 기록의 소속은 바꿀 수 없습니다' using errcode = '42501';
  end if;
  -- 개정 번호는 올라가기만 한다(낙관 동시성의 기준).
  new.revision := old.revision + 1;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function makeup_private.tg_command_only() returns trigger
language plpgsql security definer set search_path = pg_catalog as $$
begin
  if not makeup_private.in_command()
     and not (tg_op = 'UPDATE' and makeup_private.allow_unlink(to_jsonb(old), to_jsonb(new))) then
    raise exception '보강 기록은 보강관리 화면에서만 바꿀 수 있습니다' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function makeup_private.tg_no_delete() returns trigger
language plpgsql security definer set search_path = pg_catalog as $$
begin
  -- 학원 행이 이미 지워진 연쇄 삭제만 통과한다.
  if exists (select 1 from public.tenants t where t.id = old.tenant_id) then
    raise exception '보강 기록은 지울 수 없습니다 — 취소나 정정으로 남겨 주세요' using errcode = '42501';
  end if;
  return old;
end;
$$;

create or replace function makeup_private.tg_append_only() returns trigger
language plpgsql security definer set search_path = pg_catalog as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.tenants t where t.id = old.tenant_id) then
    return old;
  end if;
  if tg_op = 'UPDATE' and makeup_private.allow_unlink(to_jsonb(old), to_jsonb(new)) then
    return new;
  end if;
  raise exception '확정된 보강 기록은 고치거나 지울 수 없습니다 — 정정 기록을 새로 남겨 주세요' using errcode = '42501';
end;
$$;

alter default privileges in schema makeup_private revoke execute on functions from public;
revoke all on all functions in schema makeup_private from public, anon, authenticated;

do $$
declare
  t text;
  all_tables text[] := array[
    'makeup_policy_versions', 'makeup_cases', 'makeup_case_sources', 'makeup_sessions', 'makeup_participants',
    'makeup_allocations', 'makeup_fulfillments', 'makeup_recognitions', 'makeup_adjustments', 'makeup_events',
    'makeup_commands', 'makeup_legacy_maps', 'makeup_projection_jobs', 'makeup_reconciliation'];
  -- 고쳐 쓰는 표: 개정 번호를 올리고 소속 변경을 막는다.
  mutable text[] := array[
    'makeup_cases', 'makeup_case_sources', 'makeup_sessions', 'makeup_participants', 'makeup_allocations',
    'makeup_fulfillments', 'makeup_legacy_maps', 'makeup_projection_jobs', 'makeup_reconciliation'];
  -- 덧붙이기만 하는 표.
  append_only text[] := array[
    'makeup_policy_versions', 'makeup_recognitions', 'makeup_adjustments', 'makeup_events', 'makeup_commands'];
  -- 명령 안에서만 쓰는 표(관측 트리거가 쓰는 events·projection_jobs·reconciliation 제외).
  command_only text[] := array[
    'makeup_policy_versions', 'makeup_cases', 'makeup_case_sources', 'makeup_sessions', 'makeup_participants',
    'makeup_allocations', 'makeup_fulfillments', 'makeup_recognitions', 'makeup_adjustments', 'makeup_commands',
    'makeup_legacy_maps'];
begin
  foreach t in array all_tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on public.%I to service_role', t);
  end loop;

  foreach t in array mutable loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format('create trigger %I before update on public.%I for each row execute function makeup_private.tg_touch()',
      t || '_touch', t);
    execute format('drop trigger if exists %I on public.%I', t || '_no_delete', t);
    execute format('create trigger %I before delete on public.%I for each row execute function makeup_private.tg_no_delete()',
      t || '_no_delete', t);
  end loop;

  foreach t in array append_only loop
    execute format('drop trigger if exists %I on public.%I', t || '_append_only', t);
    execute format('create trigger %I before update or delete on public.%I for each row execute function makeup_private.tg_append_only()',
      t || '_append_only', t);
  end loop;

  foreach t in array command_only loop
    execute format('drop trigger if exists %I on public.%I', t || '_command_only', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function makeup_private.tg_command_only()',
      t || '_command_only', t);
  end loop;
end $$;

comment on schema makeup_private is
  '보강 원장 내부 함수(0343a~). API에 노출하지 않는다 — 진입점은 public.makeup_command와 읽기 RPC뿐이다.';
