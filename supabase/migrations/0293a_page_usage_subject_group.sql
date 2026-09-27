-- 0293a — 이용 분석 후속: 강사를 **과목별로** 나누고, 슈퍼관리자는 **아예 세지 않는다** (2026-09-28, 0292a 다음).
--
-- 왜: 원장 2026-09-28 *"과목별 강사 분류를 따로해"* · *"슈퍼관리자는 왜 필요하지? 슈퍼 관리자는 제외"*.
--     이 분석은 **슈퍼관리자만 보는** 도구다 — 지점에 알리지 않는다(*"전혀 지점에 알려줄 사항이 아니야 오직 superadmin만"*).
-- 무엇을:
--   ① `subject_group` 칸 — 강사(`role='teacher'`)의 직원관리 담당 과목(`users.subjects`)을 **기록 시점에** 접어 둔다.
--      한 과목 = 그 키(`math`) · 여럿 = 정렬해 `+`로 이은 키(`english+math`, "겸업") · 없음 = ''(과목 미지정).
--      강사가 아니면 늘 ''. 과목이 바뀐 날부터 새 분류로 쌓인다(지난 기록은 그때 분류 그대로 — 권한과 같은 규약).
--      PK에 넣는다 — 하루 중 과목이 바뀌면 같은 화면이 두 줄로 갈려야 ON CONFLICT가 섞지 않는다.
--   ② 슈퍼관리자 계정은 기록 함수가 **바로 돌아간다**(0292a는 'super_admin'으로 따로 적었다) + 이미 쌓인 그 행은 지운다.
--   ③ 집계 함수에 과목 필터(`p_subject`)와 과목 묶음을 더한다. 옛 4인자 함수는 지운다(같은 이름 두 벌이면 PostgREST가 헷갈린다).
-- 🔑 표 모양·RLS·권한 규약은 0292a 그대로(정책 0 · service_role 전용).
-- ⚠️ 앱은 이 파일 적용 전에도 산다([[#95]]): 과목 칸이 없으면 강사를 한 묶음으로 보이고, 과목 필터를 고를 때만 '준비 전' 안내.

begin;

alter table public.page_usage_daily add column if not exists subject_group text not null default '';

-- 과목 묶음 키 — 앱(src/features/usage/labels.ts)이 같은 모양을 읽는다. 키는 영소문자·숫자·밑줄이라 "C" 정렬이면 앱의 정렬과 같다.
create or replace function public.usage_subject_group(p_subjects text[])
returns text
language sql
immutable
set search_path = public
as $$
  select coalesce(string_agg(s, '+' order by s collate "C"), '')
  from (
    select distinct btrim(x) as s
    from unnest(coalesce(p_subjects, '{}'::text[])) as x
    where btrim(coalesce(x, '')) <> ''
  ) t;
$$;

-- ② 슈퍼관리자 기록 삭제(0292a가 'super_admin'으로 적은 것)
delete from public.page_usage_daily where role = 'super_admin';

-- ① 이미 쌓인 강사 기록에 지금의 과목을 붙인다(0292a 적용 뒤 몇 시간치뿐).
update public.page_usage_daily d
   set subject_group = public.usage_subject_group(u.subjects)
  from public.users u
 where u.id = d.user_id and d.role = 'teacher' and d.subject_group = '';

alter table public.page_usage_daily drop constraint if exists page_usage_daily_pkey;
alter table public.page_usage_daily
  add constraint page_usage_daily_pkey primary key (tenant_id, day, user_id, role, subject_group, route_key);

create or replace function public.record_page_usage(
  p_tenant uuid,
  p_user uuid,
  p_role text,
  p_day date,
  p_items jsonb
) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_subject text := '';
  v_count integer := 0;
  v_full boolean;
begin
  if p_tenant is null or p_user is null or p_role is null or p_day is null
     or p_items is null or jsonb_typeof(p_items) <> 'array' then
    return 0;
  end if;
  -- 슈퍼관리자는 세지 않는다(운영자의 점검 클릭 — 원장 2026-09-28 "슈퍼 관리자는 제외").
  if exists (select 1 from public.super_admins sa where sa.id = p_user) then
    return 0;
  end if;
  if p_role = 'teacher' then
    select public.usage_subject_group(u.subjects) into v_subject from public.users u where u.id = p_user;
    v_subject := coalesce(v_subject, '');
  end if;
  -- 행 수 상한: 한 사람·하루 새 화면 300종(0292a와 같다).
  select count(*) >= 300 into v_full
    from public.page_usage_daily e
   where e.tenant_id = p_tenant and e.day = p_day and e.user_id = p_user;

  insert into public.page_usage_daily as d
    (tenant_id, user_id, day, role, subject_group, menu_key, route_key, visits, open_seconds, active_seconds)
  select p_tenant, p_user, p_day, p_role, v_subject, max(it.menu_key), it.route_key,
         least(sum(greatest(coalesce(it.visits, 0), 0)), 500),
         least(sum(greatest(coalesce(it.open_seconds, 0), 0)), 3600),
         least(sum(least(greatest(coalesce(it.active_seconds, 0), 0), greatest(coalesce(it.open_seconds, 0), 0))), 3600)
  from jsonb_to_recordset(p_items)
       as it(route_key text, menu_key text, visits integer, open_seconds integer, active_seconds integer)
  where it.route_key is not null and it.menu_key is not null
    and char_length(it.route_key) between 1 and 160
    and char_length(it.menu_key) between 1 and 40
    and (not v_full or exists (
      select 1 from public.page_usage_daily e
       where e.tenant_id = p_tenant and e.day = p_day and e.user_id = p_user
         and e.role = p_role and e.subject_group = v_subject and e.route_key = it.route_key))
  group by it.route_key
  on conflict (tenant_id, day, user_id, role, subject_group, route_key) do update set
    visits = least(d.visits + excluded.visits, 100000),
    open_seconds = least(d.open_seconds + excluded.open_seconds, 86400),
    active_seconds = least(d.active_seconds + excluded.active_seconds, 86400),
    menu_key = excluded.menu_key,
    updated_at = now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ③ 집계 — 권한 묶음을 (권한, 과목)으로 쪼갠다(강사 아닌 권한은 과목이 늘 ''라 종전과 같다).
-- p_subject: null = 전체 · '+' = 겸업(과목 둘 이상) · '-' = 과목 미지정 · 그 밖 = 그 과목 묶음 그대로. 고르면 강사만 본다.
-- grouping() 비트: tenant_id 16 · role 8 · subject_group 4 · menu_key 2 · route_key 1 (묶음에 없는 칸 = 1).
drop function if exists public.page_usage_summary(date, date, uuid, text);

create or replace function public.page_usage_summary(
  p_from date,
  p_to date,
  p_tenant uuid default null,
  p_role text default null,
  p_subject text default null
) returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'set', s.set_name,
    'tenant_id', s.tenant_id,
    'role', s.role,
    'subject_group', s.subject_group,
    'menu_key', s.menu_key,
    'route_key', s.route_key,
    'visits', s.visits,
    'open_seconds', s.open_seconds,
    'active_seconds', s.active_seconds,
    'users', s.users
  )), '[]'::jsonb)
  from (
    select
      case grouping(tenant_id, role, subject_group, menu_key, route_key)
        when 31 then 'total'
        when 29 then 'menu'
        when 28 then 'route'
        when 19 then 'role'
        when 17 then 'role_menu'
        when 15 then 'tenant'
        when 13 then 'tenant_menu'
      end as set_name,
      tenant_id, role, subject_group, menu_key, route_key,
      sum(visits) as visits,
      sum(open_seconds) as open_seconds,
      sum(active_seconds) as active_seconds,
      count(distinct user_id) as users
    from public.page_usage_daily
    where day between p_from and p_to
      and (p_tenant is null or tenant_id = p_tenant)
      and (p_role is null or role = p_role)
      and (p_subject is null or (
        role = 'teacher' and (
          (p_subject = '+' and position('+' in subject_group) > 0)
          or (p_subject = '-' and subject_group = '')
          or subject_group = p_subject)))
    group by grouping sets (
      (), (menu_key), (menu_key, route_key), (role, subject_group), (role, subject_group, menu_key),
      (tenant_id), (tenant_id, menu_key)
    )
  ) s;
$$;

revoke all on function public.usage_subject_group(text[]) from public, anon, authenticated;
revoke all on function public.record_page_usage(uuid, uuid, text, date, jsonb) from public, anon, authenticated;
revoke all on function public.page_usage_summary(date, date, uuid, text, text) from public, anon, authenticated;
grant execute on function public.usage_subject_group(text[]) to service_role;
grant execute on function public.record_page_usage(uuid, uuid, text, date, jsonb) to service_role;
grant execute on function public.page_usage_summary(date, date, uuid, text, text) to service_role;

commit;

notify pgrst, 'reload schema';
