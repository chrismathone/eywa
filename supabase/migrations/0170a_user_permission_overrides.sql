-- 0170a — 권한 매트릭스에 **개인 예외(userOverrides)** 추가 + 이력서 restricted 백스톱을 직원관리 게이트로.
--
-- ⚠️⚠️ **적용 보류 중(2026-08-01)** — 원장이 당장 Supabase SQL Editor에 접근할 수 없어 코드 우회를 먼저
--    깔았다: staff_contracts를 읽던 3곳(목록 계약열·상세 계약이력·계약 액션의 차수계산)이 **앱 게이트
--    (개인 예외 반영) 통과 후 admin client + tenant_id 명시 필터**로 읽는다 → 이 SQL 없이도 4인 체제가
--    완전 동작한다. 단 이 SQL을 실행하기 전까지 남는 **DB 직결(PostgREST) 잔여 구멍**: ① 잠긴 관리자
--    5명이 자기 토큰으로 이력서 restricted 행을 읽을 수 있다(0148a 역할 목록이 아직 admin 포함) ②
--    잠긴 사무실 역할이 staff_contracts에 직접 쓸 수 있다(0149a office_write가 역할 목록). 화면·서버
--    액션은 전부 막혀 있어 조작 난도가 높은 틈이지만, **접근이 복구되면 이 파일을 실행해 닫을 것.**
--    실행 시점은 언제든 안전(멱등 + 실행 전후 앱 동작 불변 — 앱은 이미 admin client 경로).
--
-- 배경(2026-08-01 원장 지시): 직원관리(/staff)를 **원장 2명(원일·박소선) + 개발팀 설현·이승엽** 4인으로
-- 좁힌다. 설현·이승엽은 system_role=admin이라 **역할 축으로는 다른 관리자 5명과 구분할 수 없다** →
-- tenant_settings.data.permissions에 `userOverrides`([{userId, menu, access}])를 신설해 특정 사용자에게만
-- 셀 단위 예외를 얹는다. 코드 쪽은 applyUserOverrides(permissions.ts) + getUserPermMatrix(perm-matrix.ts).
--
-- 이 파일이 하는 일 두 가지:
--   ① auth_menu_access() 재정의 — 판정 우선순위를 master 상시 full > **개인 예외** > 역할 override >
--      코드 기본값으로 확장(개인 예외를 모르면, 역할 override로 admin=none을 거는 순간 설현·이승엽의
--      staff_contracts 읽기가 DB에서 막혀 화면과 어긋난다).
--   ② academy_documents restricted 백스톱(0148a) — **이력서 행(staff_user_id 有)** 만 역할 하드코딩
--      ('master','admin',…)에서 auth_staff_can_read()(=메뉴 권한, 개인 예외 반영)로 교체. 안 바꾸면 메뉴가
--      잠긴 관리자도 PostgREST 직결로 남의 이력서를 읽는다(#77·#92). **비이력서 restricted**(환불요청서
--      계좌 등, staff_user_id 無)는 종전 사무실 역할 그대로 — 직원관리와 무관한 문서까지 좁히지 않는다.
--
-- ⚠️ DEFAULTS jsonb는 src/lib/permissions.ts MENU_ACCESS의 **미러**다(0158a에서 이동). 이제
--    permissions-sql-mirror.test.ts가 **이 파일**을 파싱한다 — billing·expense_requests·staff·
--    textbook_requests 행을 코드에서 바꾸면 이 파일도 같은 커밋에서 바꿔야 한다.
-- ⚠️ 이 파일이 잠그지 않는 것(의도적 제외, #92 규칙 — 이름으로 적는다):
--    · staff_leaves / payroll_records — tenant_isolation뿐(0017a). 소비처가 직원관리 밖에 있다
--      (운영실 브리핑 action-signals·급여 쿼리가 admin/manager 세션에서 읽음) → auth_staff_can_read로
--      잠그면 브리핑 집계가 조용히 준다. 급여는 PAYROLL_ENABLED=false 동결 중 — 켤 때 함께 재검토.
--    · users — 직원 기본 정보(이름 등)는 강사 드롭다운·회의 화자 연결 등 전 앱이 읽는다(잠금 불가).
-- ⚠️ 게이트 함수는 정책에서 `(select f())`로 감싼다(#91) — 이 파일은 함수 재정의 + 정책 1개 교체뿐이고,
--    교체하는 정책도 감싼 형태를 유지한다.
--
-- 멱등: create or replace + drop policy if exists → create policy.
-- 롤백: ①은 0158a의 auth_menu_access 원문 재실행, ②는 0148a 원문 재실행.

-- ── ① 유효 접근수준 = 개인 예외 ?? 역할 override ?? 코드 기본값 ──────────────
-- master는 **항상 통과**(override 오설정으로 원장이 DB에서 잠기는 복구불능 상황 방지 — gotchas #60).
-- 개인 예외는 auth.uid() 본인 것만 읽는다(userId 텍스트 비교 — jsonb 안 값이라 인덱스 불요, 행 수십 개 규모).
create or replace function public.auth_menu_access(p_menu text) returns text
  language sql stable security definer set search_path = public as $$
  with me as (select coalesce(public.auth_system_role(), '') as role),
  defaults as (
    select '{
      "billing":          {"master":"full","admin":"full","manager":"readonly","teacher":"none","counselor":"none","accountant":"full","viewer":"none","student":"none"},
      "expense_requests": {"master":"full","admin":"full","manager":"none","teacher":"full","counselor":"none","accountant":"full","viewer":"none","student":"none"},
      "staff":            {"master":"full","admin":"full","manager":"full","teacher":"none","counselor":"none","accountant":"full","viewer":"none","student":"none"},
      "textbook_requests":{"master":"full","admin":"full","manager":"full","teacher":"full","counselor":"none","accountant":"full","viewer":"none","student":"none"}
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
$$;

-- ── ② 이력서 restricted 백스톱 — 역할 하드코딩 → 직원관리 메뉴 게이트(개인 예외 반영) ──
-- 0148a의 3분기(비restricted 통과 / 사무실 역할 / 본인)를 유지하되, **이력서 행만** 메뉴 게이트로 교체.
-- staff_user_id는 이력서↔직원 연결 컬럼(0147a) — 이력서에만 값이 있다(비이력서 restricted는 null).
drop policy if exists academy_documents_restricted_guard on academy_documents;
create policy academy_documents_restricted_guard on academy_documents
  as restrictive
  for all
  using (
    restricted is not true
    or (staff_user_id is null and (select public.auth_system_role()) in ('master', 'admin', 'manager', 'accountant'))
    or (staff_user_id is not null and (select public.auth_staff_can_read()))
    or staff_user_id = (select auth.uid())
  );
