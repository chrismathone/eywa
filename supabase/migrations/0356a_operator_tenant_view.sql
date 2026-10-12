-- 0356a: 운영자 '지점 보기'(읽기 전용) — 운영 콘솔에서 한 지점의 화면을 읽기 전용으로 연다.
--
-- 무엇을 바꾸나
--   ① 새 표 `operator_tenant_views` — 어느 운영자가 어느 지점을 언제까지 보는지. 서버 전용(정책 없음 = 로그인 사용자는 못 읽고 못 쓴다).
--   ② 새 함수 `operator_view_tenant()` — 지금 요청이 '지점 보기'면 그 지점, 아니면 null.
--   ③ `auth_tenant_id()` · `auth_system_role()`를 "얇은 겉함수 + 속함수"로 나눈다.
--        · 속함수 `auth_tenant_id_base()` · `auth_system_role_base()` = **종전 본문 그대로**(SECURITY DEFINER · search_path 고정).
--        · 겉함수 `auth_tenant_id()` · `auth_system_role()` = 보기 헤더가 있고 ②가 지점을 주면 그 지점 · 원장, 아니면 속함수.
--
-- 다른 사용자 · 다른 지점에는 영향이 없다
--   · 보기 토큰 헤더(`x-aywa-tenant-view`)가 없는 요청은 겉함수의 조건이 거짓(또는 null)이라 곧장 속함수 = 종전 본문으로 간다.
--     그 앞에 붙는 것은 요청 헤더 문자열에서 글자 찾기 한 번뿐이다(표 조회 없음).
--   · 헤더가 있어도 ⓐ 읽기 전용 트랜잭션이 아니거나 ⓑ 토큰의 주인이 요청자가 아니거나 ⓒ 운영자 명단에 없거나
--     ⓓ 끝났거나 만료됐으면 ②가 null을 돌려주고 **종전과 같은 값**(요청자 본인의 지점 · 역할)이 된다.
--     → 누가 이 헤더를 흉내 내어 실어도 그 사람의 지점 · 역할은 한 치도 달라지지 않는다(null로도 바뀌지 않는다).
--       null로 떨어뜨리지 않는 이유: 그러면 모든 사용자가 헤더 한 줄로 자기 역할 · 지점을 null로 만들 수 있게 되고,
--       `if 역할 not in (…) then 거절` 같은 검사는 null에서 거절하지 않고 지나간다.
--
-- 왜 겉함수 · 속함수로 나누나(실측 — 운영 DB 하드웨어, PostgreSQL 17.6, 임시 함수로 재고 되돌림)
--   · 이 두 함수는 모든 지점의 모든 조회가 지나는 자리다. PostgreSQL 17은 SQL 함수(SECURITY DEFINER)를 문장마다 · 호출 자리마다
--     다시 준비한다(약 0.27ms). 본문에 조건을 직접 넣으면 그 준비가 호출마다 +0.06ms, 줄마다 계산되는 자리에서는 줄당 +0.006ms 늘어난다.
--   · 겉함수는 SECURITY DEFINER도 SET 절도 없는 한 줄 식이라 **계획 단계에서 호출 자리에 펼쳐진다**(inline). 실행 때 따로 준비되는
--     함수가 늘지 않는다. 종전 본문은 속함수로 그대로 실행된다. 늘어나는 것(실측):
--       - 실행: 식을 한 번 계산할 때마다 "헤더에서 글자 찾기" 약 0.0015ms(줄마다 계산되는 자리의 종전 0.0615ms/줄 대비 +2.5%).
--               한 번만 계산되는 자리(인덱스 조건)에서는 측정 오차 안이다.
--       - 계획: 그 문장의 계획을 새로 세울 때 호출 자리 하나당 약 0.04ms(식을 펼치는 값). 계획이 재사용되는 문장에는 없다.
--   · 계획기가 보는 비용도 종전과 같게 맞췄다. 종전 함수 비용 100 =
--       지점: 글자 찾기 1 + 설정 읽기 1 + 비교 1 + ② 1 + ② 1 + 속함수 95   ·   역할: 글자 찾기 1 + 설정 읽기 1 + 비교 1 + ② 1 + 속함수 96.
--     → 같은 통계 · 같은 비용이라 다른 지점의 실행 계획이 달라질 이유가 없다(운영 DB에서 적용 전후 계획 1,378건이 같음을 확인했다).
--   · 겉함수의 식은 `case … end`로만 쓴다(`coalesce` 금지) — 계획기는 정책 식이 "행의 값을 흘릴 수 있는가"를 식의 모양으로
--     판정하는데, `coalesce`는 그 판정에서 '모르는 모양 = 흘릴 수 있음'으로 떨어진다. 그러면 정책 밖(보안 수준이 더 높은 자리)에서
--     쓰인 같은 식이 인덱스 조건 · 등가 묶음에서 빠져 실행 계획이 달라진다(시험에서 14ms → 671ms). `case`는 안전한 모양으로 분류된다.
--
-- 읽기 전용은 DB가 보장한다
--   · PostgREST는 GET · HEAD 요청과 STABLE/IMMUTABLE 함수 호출만 **읽기 전용 트랜잭션**으로 돌린다. INSERT · UPDATE · DELETE와
--     VOLATILE 함수는 읽기-쓰기 트랜잭션이라 ②가 null → 두 함수가 종전 값(운영자 본인의 지점 · 역할)을 돌려준다 → 보고 있는 지점의
--     행은 RLS에 걸려 한 줄도 못 바꾼다. 읽기 전용 트랜잭션 안에서는 PostgreSQL이 쓰기 자체를 거절한다.
--   · 그래서 "보는 지점으로 바뀌는 순간"과 "쓰기가 가능한 순간"이 겹치지 않는다.
--   🔴 이 전제를 깨는 것: 어떤 함수 · 설정이 `transaction_read_only`를 손으로 켜는 것. 그런 코드를 만들지 말 것(가드 테스트가 본다).
--
-- 앱이 하는 일(참고): 운영 콘솔이 ①에 한 줄을 넣고 토큰을 그 브라우저의 쿠키에 둔다. 서버가 그 쿠키를 가진 요청에만
--   헤더를 실어 보낸다(다른 기기 · 다른 브라우저의 같은 계정은 그대로 본인 지점). 쓰기 요청은 앱이 DB에 보내기 전에 막는다.
--
-- 🔴 앞으로 이 두 함수를 고칠 때
--   · 지점 · 역할을 "어떻게 찾는가"를 바꾸려면 **속함수**(`*_base`)를 고친다. 겉함수를 옛 모양(본문에 users 조회)으로 되돌리면
--     지점 보기가 조용히 사라진다(가드 테스트가 본다).
--   · 정책 · 함수는 지금처럼 `auth_tenant_id()` · `auth_system_role()`를 부른다. 속함수를 직접 부르지 말 것(보기에서 본인 지점이 섞인다).
--   · 겉함수에 SECURITY DEFINER나 SET 절을 붙이지 말 것 — 붙이면 펼쳐지지 않아 모든 조회에 함수 준비가 하나씩 더 붙는다.
--     (겉함수는 본문이 미리 해석돼 저장되므로 화면에서 본문이 비어 보이거나 search_path 경고가 뜰 수 있다 — "고치지" 말 것.)
--
-- 멱등(다시 실행해도 같다). 겉함수는 `create or replace`라 기존 권한(grant)과 정책 연결(OID)이 그대로 남는다.

-- ── ① 보기 기록 ────────────────────────────────────────────────────────────────────────────────
-- 다른 표를 참조(FK)하지 않는다 — 기존 표에 잠금도 트리거도 걸지 않으려는 것이다. 지점 · 운영자 확인은 앱과 ②가 한다.
create table if not exists public.operator_tenant_views (
  token uuid primary key default gen_random_uuid(),   -- 브라우저 쿠키에 두는 값(추측 불가)
  operator_id uuid not null,                           -- 보는 사람(auth.users.id = super_admins.id)
  tenant_id uuid not null,                             -- 보는 지점(tenants.id)
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,                     -- 이 시각이 지나면 저절로 끝난다
  ended_at timestamptz,                                -- '보기 끝내기'를 누른 시각
  constraint operator_tenant_views_expiry_ck
    check (expires_at > created_at and expires_at <= created_at + interval '12 hours')   -- 끝없는 보기를 만들 수 없다
);
create index if not exists operator_tenant_views_operator_idx
  on public.operator_tenant_views (operator_id, created_at desc);

alter table public.operator_tenant_views enable row level security;
-- 정책을 만들지 않는다 — 로그인 사용자(authenticated)·비로그인(anon)은 이 표를 읽지도 쓰지도 못한다. 서버(service_role)만 쓴다.
revoke all on public.operator_tenant_views from public, anon, authenticated;
-- 서버(service_role)의 권한은 기본 권한 설정에 기대지 않고 적어 둔다(환경마다 기본 권한이 다를 수 있다).
grant select, insert, update, delete on public.operator_tenant_views to service_role;

-- ── ② 지금 요청이 '지점 보기'인가 — 맞으면 그 지점, 아니면 null ─────────────────────────────────
-- 느린 길(헤더에 토큰 키가 있을 때만 불린다). 싼 검사부터 한다 — 정책이 줄마다 계산되는 표에서는 이 함수도 줄마다 불리므로,
-- 누가 가짜 헤더를 실어 보내도 표 조회(마지막 단계)까지 가는 일을 줄인다.
-- 오류가 날 수 있는 변환을 쓰지 않는다 — 토큰은 자리로 잘라 모양이 맞을 때만 uuid로 바꾼다(JSON 변환 없음 · 예외 블록 없음).
create or replace function public.operator_view_tenant() returns uuid
language plpgsql
stable
security definer
set search_path = public, auth
cost 1
as $$
declare
  v_uid uuid;
  v_headers text;
  v_at int;
  v_token text;
  v_tenant uuid;
begin
  -- 쓰기가 가능한 트랜잭션에서는 절대 다른 지점으로 바뀌지 않는다.
  if current_setting('transaction_read_only', true) is distinct from 'on' then
    return null;
  end if;
  -- 로그인하지 않은 요청은 볼 것이 없다.
  v_uid := auth.uid();
  if v_uid is null then
    return null;
  end if;
  -- PostgREST가 넣어 주는 요청 헤더(JSON 글자)에서 토큰을 자른다. 헤더 이름은 소문자이고 `"이름":"값"`으로 붙어 있다
  -- (겉함수가 찾는 글자와 같은 모양 = 22글자). 그 뒤 36글자가 토큰이고 바로 다음 글자가 닫는 따옴표여야 한다.
  -- 다른 헤더의 값 안에 같은 글자가 들어 있어도 거기서는 따옴표가 `\"`로 적혀 맞지 않는다.
  v_headers := current_setting('request.headers', true);
  v_at := strpos(v_headers, '"x-aywa-tenant-view":"');
  if v_at is null or v_at = 0 then
    return null;
  end if;
  v_token := substr(v_headers, v_at + 22, 36);
  if substr(v_headers, v_at + 58, 1) is distinct from '"'
     or v_token !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;
  select v.tenant_id into v_tenant
    from public.operator_tenant_views v
   where v.token = v_token::uuid
     and v.operator_id = v_uid               -- 토큰만으로는 안 된다: 그 토큰을 받은 본인이어야 한다
     and v.ended_at is null
     and v.expires_at > now()
     and exists (select 1 from public.super_admins s where s.id = v_uid);  -- 명단에서 빠지면 즉시 무효
  return v_tenant;
end;
$$;

-- ── ③-가 속함수 = 종전 본문 그대로 ──────────────────────────────────────────────────────────────
-- 비용(cost)은 겉함수의 식 전체가 종전 함수 하나(100)와 같아지게 나눈 값이다(머리 주석).
create or replace function public.auth_tenant_id_base() returns uuid
language sql
stable
security definer
set search_path = public, auth
cost 95
as $$
  select tenant_id from public.users where id = auth.uid()
$$;

create or replace function public.auth_system_role_base() returns text
language sql
stable
security definer
set search_path = public, auth
cost 96
as $$
  select system_role::text from public.users where id = auth.uid()
$$;

-- 겉함수는 호출한 역할의 권한으로 펼쳐진다 → 겉함수를 부를 수 있는 역할은 ② · 속함수도 부를 수 있어야 한다.
-- 셋 다 **부른 사람 자신의 것**만 돌려주므로(남의 지점 · 역할을 알 길이 없다) 누구나 부를 수 있게 둔다. 이렇게 두면 나중에
-- 겉함수에 새 역할의 실행 권한을 주는 마이그레이션(이 파일보다 뒤에 정렬되는 것 포함)이 속함수 권한을 빠뜨릴 일이 없다.
-- 문(門)은 종전대로 겉함수의 권한이다.
grant execute on function public.operator_view_tenant() to public;
grant execute on function public.auth_tenant_id_base() to public;
grant execute on function public.auth_system_role_base() to public;

-- ── ③-나 겉함수 — 정책 · 함수가 부르는 이름은 그대로다 ───────────────────────────────────────────
-- 본문을 미리 해석해 저장하는 형태(`return …`)로 둔다: 이름이 만들 때 정해져 호출자의 search_path에 흔들리지 않고,
-- ② · 속함수를 먼저 지우려 하면 PostgreSQL이 거절한다(되돌리는 순서를 틀려 모든 조회가 깨지는 사고를 막는다).
-- 찾는 글자는 헤더의 **키 모양 그대로**(`"x-aywa-tenant-view":"`)다 — 이름만 찾으면 다른 헤더의 값에 그 글자가 들어 있는 보통
-- 요청까지 느린 길(②)로 들어간다. 🔴 `coalesce`로 고쳐 쓰지 말 것(머리 주석 — 실행 계획이 달라진다).
-- ②를 두 번 적은 것은 그 때문이다(`coalesce(②, 속함수)`를 `case`로 풀어 쓴 모양). 두 번 불리는 것은 실제 보기 요청뿐이다.
create or replace function public.auth_tenant_id() returns uuid
language sql
stable
return case when pg_catalog.strpos(pg_catalog.current_setting('request.headers', true), '"x-aywa-tenant-view":"') > 0
             and public.operator_view_tenant() is not null
            then public.operator_view_tenant()          -- 살아 있는 보기(읽기 전용 요청): 그 지점
            else public.auth_tenant_id_base() end;      -- 그 밖의 모든 요청: 종전 그대로

create or replace function public.auth_system_role() returns text
language sql
stable
return case when pg_catalog.strpos(pg_catalog.current_setting('request.headers', true), '"x-aywa-tenant-view":"') > 0
             and public.operator_view_tenant() is not null
            then 'master'::text                         -- 지점 보기 = 그 지점 원장이 보는 범위(읽기만)
            else public.auth_system_role_base() end;

-- PostgREST에 새 함수가 생긴 것을 알린다(Supabase는 DDL마다 스스로도 알린다 — 겹쳐도 무해).
notify pgrst, 'reload schema';

-- 확인용(적용 뒤 — 읽기만 한다):
--   select p.oid::regprocedure, p.prosecdef, p.procost, p.proconfig, pg_get_function_sqlbody(p.oid) is not null as inline_body
--     from pg_proc p where p.pronamespace = 'public'::regnamespace
--      and p.proname in ('auth_tenant_id', 'auth_system_role', 'auth_tenant_id_base', 'auth_system_role_base', 'operator_view_tenant');
--   explain (costs off) select 1 from public.students where tenant_id = public.auth_tenant_id();   -- 계획에 `auth_tenant_id()`가 안 보이면 펼쳐진 것
--   select count(*) from public.operator_tenant_views;                                              -- 0
--
-- 되돌릴 때 — 🔴 **두 단계로** 한다. 한 번에 하면(겉함수를 되돌리면서 속함수까지 지우면) 그 순간 실행 중이던 문장이
--   "함수가 없다"는 오류로 실패한다(실행 중인 문장은 펼쳐 둔 속함수를 계속 부른다 — 부하 시험에서 재현).
--   [1단계] 겉함수 둘만 종전 본문으로 되돌린다. 이것으로 지점 보기는 꺼지고 모든 조회가 종전 함수로 돈다.
--   begin;
--   create or replace function public.auth_tenant_id() returns uuid language sql stable security definer
--     set search_path = public, auth cost 100 as $f$ select tenant_id from public.users where id = auth.uid() $f$;
--   create or replace function public.auth_system_role() returns text language sql stable security definer
--     set search_path = public, auth cost 100 as $f$ select system_role::text from public.users where id = auth.uid() $f$;
--   commit;
--   [2단계] 실행 중이던 문장이 다 끝난 뒤(1단계에서 1분 이상 지난 뒤 · 급할 것 없으니 한가한 때) 나머지를 지운다.
--   begin;
--   drop function public.auth_tenant_id_base();
--   drop function public.auth_system_role_base();
--   drop function public.operator_view_tenant();
--   drop table public.operator_tenant_views;
--   commit;
