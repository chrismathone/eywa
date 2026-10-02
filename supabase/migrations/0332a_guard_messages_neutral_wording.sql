-- 0332a — 보호 트리거 두 곳의 거절 문구에서 플랫폼 내부 역할 이름을 뺀다 (원장 2026-10-02)
--
-- 한글로 RAISE한 사유는 describeDbError(src/lib/supabase/db-error.ts)가 화면에 그대로 띄운다. 일반 지점 화면에는
-- 플랫폼 내부 역할 이름이나 권한 자동 통과 설명을 내지 않는다(AGENTS.md "일반 화면의 문구 원칙", 0309a와 같은 규칙).
--   · guard_user_privilege_columns   — 보호 계정의 이메일·재직 상태 변경 거절 → "이 계정을 변경할 권한이 없습니다"
--     (앱 SUPER_ADMIN_TARGET_DENIED_MSG와 같은 문구)
--   · guard_dashboard_settings_write — 대시보드 설정 변경 거절 → "대시보드 배치는 원장만 바꿀 수 있습니다"
--     (앱 saveOwnerSection과 같은 문구)
--
-- 🔴 바뀐 것은 문구 두 줄뿐이다 — 판정·예외 코드(42501)·트리거·표·칸은 그대로(0305a·0327a의 함수 본문을 그대로 다시 정의).
-- 아래 두 정의는 적용 뒤 운영 DB의 pg_get_functiondef 출력 그대로다(그래서 0305a에 있던 본문 주석은 없다 — 설명은 0305a·0327a 참고).
-- 적용: 2026-10-02 원장이 SQL 편집기에서 실행 · 조회로 확인함. 앱 배포와 무관하다. 멱등(create or replace).

begin;

CREATE OR REPLACE FUNCTION public.guard_user_privilege_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_old jsonb;
  v_changed text[];
  v_bad text[];
  v_actor_role text;
  v_is_master boolean;
  v_is_super boolean;
  v_actor_rank int;
  v_target_rank int;
  c_self_allowed constant text[] := array[
    'ui_prefs', 'teacher_view_lang', 'report_notice_mode',
      'report_display_name', 'textbook_notice_ment'
  ];
  c_salary constant text[] := array[
    'hourly_rate', 'monthly_base', 'salary_type', 'commission_rate',
      'commission_rates'
  ];
  c_hierarchy constant text[] := array['email', 'status'];
begin
  if v_uid is null then
    return new;
  end if;

  if new.id is distinct from old.id then
    raise exception 'id는 바꿀 수 없습니다' using errcode = '42501';
  end if;
  if new.system_role is distinct from old.system_role then
    raise exception
      'system_role은 직접 변경할 수 없습니다 (관리자 도구를 사용하세요)'
      using errcode = '42501';
  end if;
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'tenant_id는 직접 변경할 수 없습니다' using errcode =
      '42501';
  end if;

  v_old := to_jsonb(old);
  select coalesce(array_agg(n.key order by n.key), '{}'::text[])
    into v_changed
  from jsonb_each(to_jsonb(new)) as n(key, value)
  where n.value is distinct from (v_old -> n.key)
    and n.key <> 'updated_at';

  if cardinality(v_changed) = 0 then
    return new;
  end if;

  v_actor_role := coalesce(public.auth_system_role(), '');
  v_is_master := v_actor_role = 'master';
  v_is_super := coalesce(public.is_super_admin(v_uid), false);

  if v_is_master or v_is_super or public.auth_users_can_manage() then
    if v_changed && c_salary and not v_is_master then
      raise exception '급여 항목은 원장만 바꿀 수 있습니다' using errcode
        = '42501';
    end if;
    if 'teacher_view_access' = any (v_changed) and not (v_is_master or
      v_is_super) then
      raise exception '''강사뷰 접근''은 원장만 바꿀 수 있습니다' using
        errcode = '42501';
    end if;
    if new.id = v_uid and 'status' = any (v_changed) then
      raise exception '본인 계정의 재직 상태는 바꿀 수 없습니다' using
        errcode = '42501';
    end if;
    if new.id = v_uid and 'email' = any (v_changed) then
      raise exception '본인 로그인 이메일은 ''내 정보''에서 바꾸세요'
        using errcode = '42501';
    end if;
    if new.id <> v_uid and v_changed && c_hierarchy and not v_is_super
       and coalesce(public.is_super_admin(new.id), false) then
      raise exception '이 계정을 변경할 권한이 없습니다' using errcode =
        '42501';
    end if;
    if new.id <> v_uid and v_changed && c_hierarchy and not v_is_super
      then
      v_actor_rank := case v_actor_role
        when 'master' then 0 when 'admin' then 1 when 'manager' then 2
          when 'accountant' then 3
        when 'counselor' then 4 when 'teacher' then 5 when 'viewer' then 6
          when 'student' then 7
        else 99 end;
      v_target_rank := case old.system_role::text
        when 'master' then 0 when 'admin' then 1 when 'manager' then 2
          when 'accountant' then 3
        when 'counselor' then 4 when 'teacher' then 5 when 'viewer' then 6
          when 'student' then 7
        else 99 end;
      if v_actor_rank > v_target_rank then
        raise exception
          '본인보다 상위 권한 직원의 로그인 이메일·재직 상태는 바꿀 수 없습니다'
          using errcode = '42501';
      end if;
    end if;
    return new;
  end if;

  if v_changed <@ array['subjects']::text[] and
    public.auth_users_can_absorb_subjects() then
    return new;
  end if;

  if new.id = v_uid then
    v_bad := array(select unnest(v_changed) except select
      unnest(c_self_allowed));
    if cardinality(v_bad) > 0 then
      raise exception '본인 계정에서 직접 바꿀 수 없는 항목입니다: %',
        array_to_string(v_bad, ', ')
        using errcode = '42501';
    end if;
    return new;
  end if;

  raise exception '다른 직원 계정을 바꿀 권한이 없습니다' using errcode =
    '42501';
end;
$function$;

CREATE OR REPLACE FUNCTION public.guard_dashboard_settings_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then
    return new;
  end if;

  if exists (
    select 1
    from public.users
    where id = auth.uid()
      and system_role = 'master'
  ) or coalesce(public.is_super_admin(auth.uid()), false) then
    return new;
  end if;

  raise exception '대시보드 배치는 원장만 바꿀 수 있습니다'
    using errcode = '42501';
end;
$function$;

commit;
