-- s2_0024 — 직원 역할 '아르바이트'(parttime) 추가 (2026-11-05)
--
-- 왜: 원장 *"권한 하나 더 추가해줘 열람보다 낮은 등급 '아르바이트'"*. 지금 아르바이트 직원은 '열람(viewer)'이라
--     원생·상담·퇴원·회의록 등을 기본으로 읽을 수 있다. 아르바이트는 기본으로 도움말·고객센터만 쓰고,
--     필요한 메뉴는 원장이 학원 설정 → 역할·권한 표나 개인별 메뉴 권한으로 연다(랩실·JJ실 출석은 직원관리 '자리 담당').
-- 무엇: ① public.system_role 열거형에 'parttime' 값 하나를 'student' 앞에 넣는다.
--   ② auth_menu_access(0170a 정의 그대로)의 코드 기본값 표(DEFAULTS)에 "parttime":"none"을 더한다 — 판정 결과는 같다
--     (표에 없는 역할도 'none'으로 떨어진다). 표가 permissions.ts MENU_ACCESS의 미러라 칸을 맞춰 둔다
--     (가드 src/lib/permissions-sql-mirror.test.ts — 살아있는 정의를 이 파일로 옮겼다).
--   · settings_menu_access / auth_can_use_timetable_lab: 기본값을 역할 목록으로 정하지 않아(원장·관리자 계열만 'full',
--     나머지 'none') 아르바이트는 따로 적지 않아도 기본 '없음'이다.
--   · guard_user_privilege_columns(이메일·재직 상태를 바꿀 때의 위계): 모르는 역할은 99(가장 아래)로 본다 —
--     아르바이트가 남의 계정을 바꿀 수 없고, 관리자는 아르바이트 계정을 바꿀 수 있다(앱 ROLE_HIERARCHY와 같은 방향).
--   · '학생만 빼고 직원은 읽는' 표 6개(classnote_parent_messages·classnote_child_links·classnote_sync_requests·
--     classnote_parent_replies·classnote_parent_reactions·homework_video_links)는 그대로 둔다 — 원장이 아르바이트에게
--     원생목록을 열면 그 화면이 이 표를 읽는다. 여기서 막으면 화면 일부가 조용히 비어 보인다. 무엇을 보느냐는 메뉴 권한이 정한다.
-- 적용 순서: 🔴 **웹 배포 전에** 적용한다(웹이 'parttime'으로 저장하려 하면 열거형에 값이 있어야 한다).
-- 적용 확인(읽기만):
--   select enum_range(null::public.system_role);   -- 기대: {master,admin,manager,teacher,counselor,accountant,viewer,parttime,student}
--
-- 되돌리기: 열거형 값은 지울 수 없다. 이 역할을 쓰는 계정이 없으면 그대로 둬도 아무 판정에도 걸리지 않는다.

begin;
set local lock_timeout = '3s';

alter type public.system_role add value if not exists 'parttime' before 'student';

-- ② 0170a의 auth_menu_access — DEFAULTS 네 줄에 "parttime":"none"만 더했다(나머지 글자 그대로, 권한·소유자 유지).
CREATE OR REPLACE FUNCTION public.auth_menu_access(p_menu text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with me as (select coalesce(public.auth_system_role(), '') as role),
  defaults as (
    select '{
      "billing":          {"master":"full","admin":"full","manager":"readonly","teacher":"none","counselor":"none","accountant":"full","viewer":"none","parttime":"none","student":"none"},
      "expense_requests": {"master":"full","admin":"full","manager":"none","teacher":"full","counselor":"none","accountant":"full","viewer":"none","parttime":"none","student":"none"},
      "staff":            {"master":"full","admin":"full","manager":"full","teacher":"none","counselor":"none","accountant":"full","viewer":"none","parttime":"none","student":"none"},
      "textbook_requests":{"master":"full","admin":"full","manager":"full","teacher":"full","counselor":"none","accountant":"full","viewer":"none","parttime":"none","student":"none"}
    }'::jsonb as d
  ),
  ov as (
    select o->>'access' as access
    from tenant_settings ts,
         lateral jsonb_array_elements(coalesce(ts.data->'permissions'->'overrides', '[]'::jsonb)) o
    where ts.tenant_id = public.auth_tenant_id()
      and o->>'menu' = p_menu
      and o->>'role' = (select role from me)
    limit 1
  ),
  uov as (
    select o->>'access' as access
    from tenant_settings ts,
         lateral jsonb_array_elements(coalesce(ts.data->'permissions'->'userOverrides', '[]'::jsonb)) o
    where ts.tenant_id = public.auth_tenant_id()
      and o->>'menu' = p_menu
      and o->>'userId' = (select auth.uid())::text
    limit 1
  )
  select case
    when (select role from me) = 'master' then 'full'
    else coalesce(
      (select access from uov),
      (select access from ov),
      (select d->p_menu->>(select role from me) from defaults),
      'none')
  end
$function$;

commit;
