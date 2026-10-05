-- 0344a — 보강관리 권한 helper: 행위자 · 메뉴 접근수준 · 운영 모드 · 담당 범위
--
-- 🔴 `auth_menu_access()`를 쓰지 않는다 — 그 함수의 기본값 표에는 이 메뉴 키가 없어 원장 외 전원이 막힌다
--    ([[#92]]). 이 파일이 `makeups` 키의 판정을 따로 가진다(0333a·0335a와 같은 방식).
-- 🔴 행위자는 **`auth.uid()` → 지금의 public.users 행**에서만 읽는다(JWT에 실린 역할·학원을 믿지 않는다).
--    로그인하지 않은 호출과 관리자 클라이언트(service_role, auth.uid() 없음)는 전부 거절된다 — 행위자를
--    인자로 받는 길이 없어서 다른 사람 이름으로 명령을 낼 수 없다.
-- 판정 순서: 원장 상시 full > 개인 예외(userOverrides) > 역할 override > 기본값
--   기본값 = 원장·관리자·매니저 full · 강사 scoped · 그 밖 none(src/lib/permissions.ts MENU_ACCESS와 같게 유지).
-- 접근수준의 뜻:
--   full     = 지점 전체 운영(접수·담당·일정·대리입력)        scoped = 담당 범위만(owner·지금 담당 반·배정된 회차)
--   readonly = 읽기만(강사는 읽기도 담당 범위)                none   = 사용 불가
--   승인·거절·면제·수량 조정·검토·반전·종결·시수 대사 해결은 full이면서 원장·관리자인 계정만 한다.
-- 멱등: create or replace. 타입은 없을 때만 만든다.

do $$ begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'makeup_private' and t.typname = 'actor_ctx') then
    create type makeup_private.actor_ctx as (
      user_id uuid, tenant_id uuid, role text, name text, is_super boolean,
      access text, wide boolean, privileged boolean, can_configure boolean,
      mode text, allow_additional boolean, pilot_subjects text[], today date);
  end if;
end $$;

-- 한글 사유 + 기계 판독 코드(detail JSON)로 실패시킨다. 화면은 문장을, 앱은 code를 읽는다.
create or replace function makeup_private.fail(p_code text, p_message text, p_detail jsonb default '{}'::jsonb)
returns void language plpgsql set search_path = pg_catalog as $$
begin
  raise exception '%', p_message
    using errcode = case when p_code = 'forbidden' then '42501' else 'P0001' end,
          detail = (jsonb_build_object('code', p_code) || coalesce(p_detail, '{}'::jsonb))::text;
end;
$$;

create or replace function makeup_private.normalize_settings(m jsonb) returns jsonb
language sql immutable set search_path = pg_catalog as $$
  select jsonb_build_object(
    'mode', case when m ->> 'mode' in ('on', 'draining') then m ->> 'mode' else 'off' end,
    'allowAdditional', coalesce((m -> 'allowAdditional') = 'true'::jsonb, false),
    'pilotSubjects', case when jsonb_typeof(m -> 'pilotSubjects') = 'array' then m -> 'pilotSubjects'
                          else '["math"]'::jsonb end)
$$;

-- 운영 모드 정본 = tenant_settings.data.makeups(없으면 꺼짐).
-- 🔴 첫 운영 범위는 서버가 고정한다: 대상 과목 = 수학 하나 · 추가 지도 꺼짐. 저장된 값이 무엇이든(옛 값·직접 쓴 값)
--    명령·읽기가 쓰는 유효 설정은 이 범위를 넘지 못한다. 범위를 넓히는 것은 새 마이그레이션의 일이다(0346l configure도 거절).
create or replace function makeup_private.settings(p_tenant uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select makeup_private.normalize_settings(
    (select ts.data -> 'makeups' from public.tenant_settings ts where ts.tenant_id = p_tenant))
    || '{"allowAdditional": false, "pilotSubjects": ["math"]}'::jsonb
$$;

create or replace function makeup_private.max_access(variadic p text[]) returns text
language sql immutable set search_path = pg_catalog as $$
  select coalesce((select v from unnest(p) v where v in ('full', 'scoped', 'readonly', 'none')
                   order by array_position(array['none', 'readonly', 'scoped', 'full'], v) desc limit 1), 'none')
$$;

create or replace function makeup_private.actor() returns makeup_private.actor_ctx
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  a makeup_private.actor_ctx;
  v_uid uuid := auth.uid();
  v_status text;
  v_perms jsonb;
  v_cfg jsonb;
  v_base text;
  v_role_acc text;
  v_user_acc text;
begin
  if v_uid is null then perform makeup_private.fail('forbidden', '로그인이 필요합니다'); end if;
  select u.id, u.tenant_id, u.system_role::text, u.display_name, u.status::text
    into a.user_id, a.tenant_id, a.role, a.name, v_status
    from public.users u where u.id = v_uid;
  if a.user_id is null or v_status is distinct from 'active' or a.role = 'student' then
    perform makeup_private.fail('forbidden', '보강관리를 쓸 수 없는 계정입니다');
  end if;
  a.is_super := coalesce(public.is_super_admin(v_uid), false);
  select coalesce(ts.data -> 'permissions', '{}'::jsonb) into v_perms
    from public.tenant_settings ts where ts.tenant_id = a.tenant_id;
  v_perms := coalesce(v_perms, '{}'::jsonb);
  v_base := case when a.role in ('master', 'admin', 'manager') then 'full'
                 when a.role = 'teacher' then 'scoped' else 'none' end;
  select o ->> 'access' into v_role_acc
    from jsonb_array_elements(case when jsonb_typeof(v_perms -> 'overrides') = 'array'
                                   then v_perms -> 'overrides' else '[]'::jsonb end) with ordinality x(o, n)
   where o ->> 'menu' = 'makeups' and o ->> 'role' = a.role
     and o ->> 'access' in ('full', 'scoped', 'readonly', 'none')
   order by n desc limit 1;
  select o ->> 'access' into v_user_acc
    from jsonb_array_elements(case when jsonb_typeof(v_perms -> 'userOverrides') = 'array'
                                   then v_perms -> 'userOverrides' else '[]'::jsonb end) with ordinality x(o, n)
   where o ->> 'menu' = 'makeups' and o ->> 'userId' = v_uid::text
     and o ->> 'access' in ('full', 'scoped', 'readonly', 'none')
   order by n desc limit 1;
  a.access := case
    when a.role = 'master' then 'full'
    -- 잠금은 무시하고 부여는 보존한다(셋 중 가장 넓은 값).
    when a.is_super then makeup_private.max_access(v_base, v_role_acc, v_user_acc)
    else coalesce(v_user_acc, v_role_acc, v_base) end;
  if a.access = 'none' then perform makeup_private.fail('forbidden', '보강관리 권한이 없습니다'); end if;
  a.wide := a.access = 'full';
  a.privileged := a.wide and (a.role in ('master', 'admin') or a.is_super);
  a.can_configure := a.role = 'master' or a.is_super;
  v_cfg := makeup_private.settings(a.tenant_id);
  a.mode := v_cfg ->> 'mode';
  a.allow_additional := (v_cfg ->> 'allowAdditional')::boolean;
  a.pilot_subjects := array(select jsonb_array_elements_text(v_cfg -> 'pilotSubjects'));
  a.today := (now() at time zone 'Asia/Seoul')::date;
  return a;
end;
$$;

-- 지금 담당하는 반(담임 · 유효한 교시 담당 · 유효한 위임). 기준일이 지나면 그날로 권한이 풀린다.
create or replace function makeup_private.my_class_ids(p_tenant uuid, p_user uuid, p_on date) returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select c.id from public.classes c where c.tenant_id = p_tenant and c.teacher_id = p_user
  union
  select cs.class_id from public.class_schedules cs
   where cs.tenant_id = p_tenant and cs.teacher_id = p_user
     and cs.valid_from <= p_on and (cs.valid_to is null or cs.valid_to >= p_on)
  union
  select d.class_id from public.class_delegations d
   where d.tenant_id = p_tenant and d.delegate_user_id = p_user and d.revoked_at is null
     and d.from_date <= p_on and d.to_date >= p_on
$$;

-- 그 학생이 지금 내 담당 반(같은 과목)에 다니는가 — 추가 지도 접수·명단 읽기의 범위. 다른 과목 담당은 해당 없다.
create or replace function makeup_private.teaches_student(a makeup_private.actor_ctx, p_student uuid, p_subject text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.enrollments e
      join public.classes c on c.id = e.class_id and c.subject = p_subject
     where e.tenant_id = a.tenant_id and e.student_id = p_student
       and e.start_date <= a.today and (e.end_date is null or e.end_date > a.today)
       and e.class_id in (select makeup_private.my_class_ids(a.tenant_id, a.user_id, a.today)))
$$;

create or replace function makeup_private.can_read_all(a makeup_private.actor_ctx) returns boolean
language sql immutable set search_path = pg_catalog as $$
  select a.wide or (a.access = 'readonly' and a.role <> 'teacher')
$$;

-- 케이스가 행위자의 범위 안인가 — 목록·상세·명령·재시도 결과가 전부 이 판정을 지난다(#77).
create or replace function makeup_private.in_scope(a makeup_private.actor_ctx, p_case_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.makeup_cases c
     where c.id = p_case_id and c.tenant_id = a.tenant_id and (
       makeup_private.can_read_all(a)
       or c.owner_id = a.user_id
       or c.original_class_id in (select makeup_private.my_class_ids(a.tenant_id, a.user_id, a.today))
       or (c.original_class_id is null and makeup_private.teaches_student(a, c.student_id, c.subject_key))
       or exists (
         select 1 from public.makeup_allocations al
           join public.makeup_participants p on p.id = al.participant_id and p.status <> 'cancelled'
           join public.makeup_sessions s on s.id = p.session_id and s.state in ('confirmed', 'finished')
          where al.case_id = c.id and s.teacher_id = a.user_id)))
$$;

create or replace function makeup_private.require_mode(a makeup_private.actor_ctx, p_action text) returns void
language plpgsql set search_path = pg_catalog as $$
begin
  if a.mode = 'off' and p_action <> 'configure' then
    perform makeup_private.fail('mode_off', '보강관리가 꺼져 있습니다 — 학원 설정에서 켠 뒤 사용해 주세요');
  end if;
  if a.mode = 'draining' and p_action in ('intake', 'reserve', 'reschedule', 'link_legacy') then
    perform makeup_private.fail('mode_draining', '보강관리를 정리하는 중이라 새 접수와 새 일정은 받지 않습니다');
  end if;
end;
$$;

-- level: write(읽기 전용 거절) · wide(지점 전체 운영) · privileged(원장·관리자 결정) · configure(원장).
create or replace function makeup_private.require_level(a makeup_private.actor_ctx, p_level text) returns void
language plpgsql set search_path = pg_catalog as $$
begin
  if a.access = 'readonly' then
    perform makeup_private.fail('forbidden', '읽기 전용 권한이라 변경할 수 없습니다');
  elsif p_level = 'wide' and not a.wide then
    perform makeup_private.fail('forbidden', '담당 범위 밖의 작업입니다 — 관리자에게 요청해 주세요');
  elsif p_level = 'privileged' and not a.privileged then
    perform makeup_private.fail('forbidden', '승인 권한이 있는 관리자만 할 수 있는 작업입니다');
  elsif p_level = 'configure' and not a.can_configure then
    perform makeup_private.fail('forbidden', '보강관리 설정은 원장만 바꿀 수 있습니다');
  end if;
end;
$$;

revoke all on all functions in schema makeup_private from public, anon, authenticated;
