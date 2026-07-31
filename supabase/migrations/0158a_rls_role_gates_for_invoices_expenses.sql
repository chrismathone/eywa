-- 0158a — 수납(invoices)·지출(expenses) 역할 게이트를 **DB로** 내린다.
--
-- 배경(2026-07-30 수납 적대 리뷰): 두 테이블의 정책이 `*_tenant_isolation` 하나뿐이었다
--   for all to authenticated using (tenant_id = auth_tenant_id())
-- → 역할을 전혀 안 본다. billing 권한이 없는 teacher(31계정)·viewer(8계정)도 **자기 access token으로
--   PostgREST(/rest/v1/invoices, /rest/v1/expenses)에 직접 붙으면** 학원 전 청구서와 전 지출
--   (거래처·직원 **계좌번호** 포함)을 SELECT/UPDATE/DELETE 할 수 있었다.
--   앱 게이트(requireAccess/canWriteTenant)는 화면만 잠근다 = gotchas #77 "화면에서만 잠갔다".
--
-- 기존 `*_tenant_isolation`(PERMISSIVE)은 **그대로 두고** RESTRICTIVE를 얹는다(둘 다 통과해야 통과).
-- service_role은 BYPASSRLS라 makeedu 동기화 스크립트·admin client·super-admin 집계는 영향 없음.
--
-- ⚠️⚠️ 역할을 코드에 박지 않는다 — **학원설정(권한 매트릭스)을 읽는다.**
--    권한은 owner 화면에서 테넌트별로 덮어쓸 수 있고(`tenant_settings.data.permissions.overrides`),
--    injaewon은 실제로 billing을 manager=full·counselor=readonly로 올려 두었다. 하드코딩했다면
--    이 두 역할이 DB에서 잠겨 "설정은 켰는데 화면이 빈" 회귀가 났을 것이다(운영 enum 하드코딩 금지와 같은 원칙).
--    → `auth_menu_access(menu)`가 **override ?? 코드 기본값**으로 유효 접근수준을 돌려준다.
--
-- ⚠️ 코드 기본값(DEFAULTS jsonb)은 src/lib/permissions.ts `MENU_ACCESS`의 **미러**다. 드리프트를 막기 위해
--    `src/lib/permissions-sql-mirror.test.ts`가 이 파일을 파싱해 MENU_ACCESS와 일치하는지 검사한다.
--    permissions.ts에서 billing·expense_requests 행을 바꾸면 **이 파일도 같은 커밋에서** 바꿔야 한다.
--
-- ⚠️ textbook_orders는 같은 구멍이 있으나 **created_by 컬럼이 없다**(teacher_name text만) —
--    강사 본인 요청을 DB에서 안전하게 식별할 수 없어 이 마이그레이션에서 **의도적으로 제외**한다.
--    잠그면 강사 교재요청이 통째로 막힌다(fail-closed 락아웃). 근본 해결 = textbook_orders.created_by 도입 후
--    아래 expenses와 같은 패턴 추가.
--
-- 멱등: create or replace function + drop policy if exists → create policy.
-- 롤백: 아래 8개 정책을 drop하면 즉시 원상복구(기존 tenant_isolation은 안 건드림).

-- ── 유효 접근수준 = override ?? 코드 기본값 ──────────────────────────────────
-- master는 **항상 통과**시킨다: override 오설정으로 원장이 DB에서 잠기는 복구불능 상황 방지
-- (perm-matrix.ts의 fail-open 폴백과 같은 취지 — gotchas #60).
create or replace function public.auth_menu_access(p_menu text) returns text
  language sql stable security definer set search_path = public as $$
  with me as (select coalesce(public.auth_system_role(), '') as role),
  defaults as (
    select '{
      "billing":          {"master":"full","admin":"full","manager":"readonly","teacher":"none","counselor":"none","accountant":"full","viewer":"none","student":"none"},
      "expense_requests": {"master":"full","admin":"full","manager":"none","teacher":"full","counselor":"none","accountant":"full","viewer":"none","student":"none"}
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
  )
  select case
    when (select role from me) = 'master' then 'full'
    else coalesce((select access from ov), (select d->p_menu->>(select role from me) from defaults), 'none')
  end
$$;

create or replace function public.auth_billing_can_read() returns boolean
  language sql stable security definer set search_path = public as $$
  select public.auth_menu_access('billing') <> 'none'
$$;

create or replace function public.auth_billing_can_write() returns boolean
  language sql stable security definer set search_path = public as $$
  select public.auth_menu_access('billing') in ('full', 'scoped')
$$;

-- 지출결의서를 **작성**할 수 있는 역할(본인 작성분 한정 스코프의 주체).
create or replace function public.auth_expense_can_submit() returns boolean
  language sql stable security definer set search_path = public as $$
  select public.auth_menu_access('expense_requests') in ('full', 'scoped')
$$;

-- ⚠️ 게이트 함수는 **반드시 `(select f())`로 감싼다**(2026-07-31 추가). 컬럼을 하나도 안 쓰는 순수
--    불리언 함수를 맨몸으로 쓰면 플래너가 상수로 못 접어 **스캔한 행마다** 호출한다(이 함수 1회 = 14ms
--    → 3,225행 스캔에 2.1초). `(select …)`로 감싸면 InitPlan으로 끌어올려 문장당 1회다. 상세·실측 = 0162a.
--    ✋ 여기서 풀지 말 것 — 0162a가 alter로 덧칠하지만, **이 파일만 단독 재적용**하면(단일 파일 핫픽스·
--       권한 미러 수정 등) 맨몸 형태가 되살아나고 에러가 0건이라 아무도 눈치채지 못한다.
--    ✋ 반대로 `created_by = auth.uid()`처럼 **컬럼을 쓰는 항은 감싸면 안 된다**(행마다 평가돼야 맞다).

-- ── invoices ────────────────────────────────────────────────────────────────
drop policy if exists invoices_role_gate_select on public.invoices;
create policy invoices_role_gate_select on public.invoices
  as restrictive for select to authenticated
  using ((select public.auth_billing_can_read()));

drop policy if exists invoices_role_gate_insert on public.invoices;
create policy invoices_role_gate_insert on public.invoices
  as restrictive for insert to authenticated
  with check ((select public.auth_billing_can_write()));

drop policy if exists invoices_role_gate_update on public.invoices;
create policy invoices_role_gate_update on public.invoices
  as restrictive for update to authenticated
  using ((select public.auth_billing_can_write()))
  with check ((select public.auth_billing_can_write()));

drop policy if exists invoices_role_gate_delete on public.invoices;
create policy invoices_role_gate_delete on public.invoices
  as restrictive for delete to authenticated
  using ((select public.auth_billing_can_write()));

-- ── expenses ────────────────────────────────────────────────────────────────
-- 사무실(billing 접근) + **본인이 작성한 지출결의서**(강사 제출 경로 보존 — 앱의 guardOwnExpense와 같은 규칙).
-- created_by가 null인 구데이터(145행)는 사무실만 보인다 — 강사 소유가 아니므로 의도한 결과.
drop policy if exists expenses_role_gate_select on public.expenses;
create policy expenses_role_gate_select on public.expenses
  as restrictive for select to authenticated
  using (
    (select public.auth_billing_can_read())
    or ((select public.auth_expense_can_submit()) and created_by = (select auth.uid()))
  );

drop policy if exists expenses_role_gate_insert on public.expenses;
create policy expenses_role_gate_insert on public.expenses
  as restrictive for insert to authenticated
  with check (
    (select public.auth_billing_can_write())
    or ((select public.auth_expense_can_submit()) and created_by = (select auth.uid()))
  );

drop policy if exists expenses_role_gate_update on public.expenses;
create policy expenses_role_gate_update on public.expenses
  as restrictive for update to authenticated
  using (
    (select public.auth_billing_can_write())
    or ((select public.auth_expense_can_submit()) and created_by = (select auth.uid()))
  )
  with check (
    (select public.auth_billing_can_write())
    or ((select public.auth_expense_can_submit()) and created_by = (select auth.uid()))
  );

drop policy if exists expenses_role_gate_delete on public.expenses;
create policy expenses_role_gate_delete on public.expenses
  as restrictive for delete to authenticated
  using (
    (select public.auth_billing_can_write())
    or ((select public.auth_expense_can_submit()) and created_by = (select auth.uid()))
  );
