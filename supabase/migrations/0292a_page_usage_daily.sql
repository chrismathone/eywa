-- 0292a — 이용 분석: 화면별 방문·화면 시간·활동 시간 **일별 롤업** (2026-09-28, 슈퍼관리자 '이용 분석').
--
-- 왜: 원장 2026-09-28 *"각 사용자 권한 별로 어디에 많이 접속하는지, 사용자가 어떤 페이지에 오래 머무는지 체크할 수 있는
--     페이지"* · *"지점별로도"* · *"가장 많이 방문하고 이용하고 사용하는 기능들"* · *"가만히 멍때리고 있는 경우도 있을 수
--     있기에 실제 활동하는 시간을 카운트하는게 가장 중요할듯. 아니면 동시에 더블체크해도 되고"* — 유지보수를 어디에 집중할지
--     정하는 근거다.
-- 무엇을: 셸 계측기(src/features/usage)가 문서(창)마다 세는 두 시간을 **함께** 쌓는다.
--   · open_seconds   = 화면 시간 — 보이고(최소화·가려진 창·숨은 탭 제외) 그 화면을 잡고 있던 시간(멍하니 띄워 둔 시간 포함)
--   · active_seconds = 활동 시간 — 그중 입력(클릭·키·휠·터치·마우스 움직임) 후 60초 안쪽. 항상 ≤ open_seconds
--   · visits         = 방문 — 화면 시간이 처음 쌓인 순간 1회(복원만 되고 안 본 창은 안 센다)
-- 모양: 행을 쌓지 않고 **더한다** — (지점, 날짜, 사람, 권한, 화면) = 1행. 50명 × 하루 10화면이면 하루 500행.
--
-- 🔴 RLS는 켜되 **정책을 일부러 두지 않는다**(gotcha #104의 "의도적 제외"를 여기 적는다):
--    읽기·쓰기 모두 service_role(비콘 라우트 · 슈퍼관리자 콘솔)만. 직원 한 사람의 화면 체류 시간은
--    학원 안(원장 포함)에 PostgREST로 열지 않는다 — 화면도 사람 단위가 아니라 권한·지점 단위 집계만 보여 준다.
--    테이블 권한도 anon·authenticated에서 거둔다(정책 누락으로 열리는 사고의 이중 방어).
-- 🔑 쓰기·집계 함수 둘 다 service_role 전용 실행 권한이다.
-- ⚠️ 앱은 이 파일 적용 전에도 산다([[#95]]): 비콘 라우트는 기록 실패를 삼키고, 분석 화면은 "DB 적용 전" 안내를 띄운다.

begin;

create table if not exists public.page_usage_daily (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  day date not null,                           -- KST 날짜
  role text not null,                          -- 기록 시점 시스템 역할. 슈퍼관리자 계정은 'super_admin'
  menu_key text not null,                      -- 메뉴 키(src/lib/permissions MENU_KEYS) 또는 'other'
  route_key text not null,                     -- 정규화한 화면 식별자: '/students/[id]' · '/billing?tab=sessions'
  visits integer not null default 0,
  open_seconds integer not null default 0,
  active_seconds integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint page_usage_daily_pkey primary key (tenant_id, day, user_id, role, route_key),
  constraint page_usage_daily_nonneg check (visits >= 0 and open_seconds >= 0 and active_seconds >= 0),
  constraint page_usage_daily_active_le_open check (active_seconds <= open_seconds)
);

-- 전 지점 기간 집계(지점 필터 없음)용. 지점을 고르면 PK(tenant_id, day …)가 받는다.
create index if not exists page_usage_daily_day_idx on public.page_usage_daily (day);

alter table public.page_usage_daily enable row level security;
revoke all on table public.page_usage_daily from anon, authenticated;

-- 쓰기: 비콘 한 번 = 이 함수 한 번. 같은 화면이 한 배열에 둘 있어도 먼저 합친다
-- (한 INSERT … ON CONFLICT가 같은 행을 두 번 고치면 문장 전체가 실패한다).
-- 상한: 한 번에 방문 500·초 3600(앱 관문과 같은 값) / 하루 누적 방문 100000·초 86400.
-- 🔴 행 수 상한: 한 사람·하루에 **새 화면 300종**까지(그 뒤로는 이미 있는 화면만 더한다) — 비콘은 로그인한 누구나
--    손으로 보낼 수 있어서, 앱 관문(셸 경로만)을 지나는 낱말 조합으로 행을 무한히 늘리는 것을 여기서 막는다.
--    평소 한 사람이 하루에 여는 화면은 수십 종이다.
-- 활동 ⊆ 화면: 한 줄마다 least(active, open)로 자르고 누적도 같은 비율로 자르므로 check가 깨지지 않는다.
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
  v_role text := p_role;
  v_count integer := 0;
  v_full boolean;
begin
  if p_tenant is null or p_user is null or p_role is null or p_day is null
     or p_items is null or jsonb_typeof(p_items) <> 'array' then
    return 0;
  end if;
  if exists (select 1 from public.super_admins sa where sa.id = p_user) then
    v_role := 'super_admin';
  end if;
  select count(*) >= 300 into v_full
    from public.page_usage_daily e
   where e.tenant_id = p_tenant and e.day = p_day and e.user_id = p_user;

  insert into public.page_usage_daily as d
    (tenant_id, user_id, day, role, menu_key, route_key, visits, open_seconds, active_seconds)
  select p_tenant, p_user, p_day, v_role, max(it.menu_key), it.route_key,
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
         and e.role = v_role and e.route_key = it.route_key))
  group by it.route_key
  on conflict (tenant_id, day, user_id, role, route_key) do update set
    visits = least(d.visits + excluded.visits, 100000),
    open_seconds = least(d.open_seconds + excluded.open_seconds, 86400),
    active_seconds = least(d.active_seconds + excluded.active_seconds, 86400),
    menu_key = excluded.menu_key,
    updated_at = now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- 읽기: 기간(+지점·권한) 필터 한 번에 화면이 쓰는 묶음 7가지를 grouping sets로 한 번에 뽑는다.
-- 🔑 결과는 **jsonb 하나**다 — setof로 돌려주면 PostgREST max-rows(≈1000)에 조용히 잘린다(gotcha #54).
-- 🔑 users = 그 묶음에서 한 번이라도 쓴 사람 수(count distinct) — 묶음끼리 더할 수 없어서 SQL에서 센다.
-- grouping() 비트: tenant_id 8 · role 4 · menu_key 2 · route_key 1 (묶음에 없는 칸 = 1).
create or replace function public.page_usage_summary(
  p_from date,
  p_to date,
  p_tenant uuid default null,
  p_role text default null
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
    'menu_key', s.menu_key,
    'route_key', s.route_key,
    'visits', s.visits,
    'open_seconds', s.open_seconds,
    'active_seconds', s.active_seconds,
    'users', s.users
  )), '[]'::jsonb)
  from (
    select
      case grouping(tenant_id, role, menu_key, route_key)
        when 15 then 'total'
        when 13 then 'menu'
        when 12 then 'route'
        when 11 then 'role'
        when 9 then 'role_menu'
        when 7 then 'tenant'
        when 5 then 'tenant_menu'
      end as set_name,
      tenant_id, role, menu_key, route_key,
      sum(visits) as visits,
      sum(open_seconds) as open_seconds,
      sum(active_seconds) as active_seconds,
      count(distinct user_id) as users
    from public.page_usage_daily
    where day between p_from and p_to
      and (p_tenant is null or tenant_id = p_tenant)
      and (p_role is null or role = p_role)
    group by grouping sets (
      (), (menu_key), (menu_key, route_key), (role), (role, menu_key), (tenant_id), (tenant_id, menu_key)
    )
  ) s;
$$;

revoke all on function public.record_page_usage(uuid, uuid, text, date, jsonb) from public, anon, authenticated;
revoke all on function public.page_usage_summary(date, date, uuid, text) from public, anon, authenticated;
grant execute on function public.record_page_usage(uuid, uuid, text, date, jsonb) to service_role;
grant execute on function public.page_usage_summary(date, date, uuid, text) to service_role;

commit;

notify pgrst, 'reload schema';
