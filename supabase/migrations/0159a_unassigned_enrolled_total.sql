-- 0159a: 반 미배정 재원생 RPC가 **전체 수**를 함께 돌려준다 (2026-07-31 브리핑 전수검사).
--
-- 🔴 고치는 버그: 호출부가 `limit p_limit`으로 잘린 **배열 길이를 건수로** 보고했다.
--    실측(injaewon 2026-07-31) — 브리핑·대시보드 표시 "반 미배정 재원생 30건" / 실제 34명.
--    상한(30)에 닿는 순간 실제가 34명이든 50명이든 화면은 영원히 "30"이고, 잘린 학생(이민혜·이서윤·
--    박소령·도성훈)은 매일 조용히 누락된다. 0097a/0114a 도입 시점엔 "대개 1~2명"이라 상한이 안 보였다.
--
--    윈도우 함수 `count(*) over ()`는 LIMIT **이전에** 평가되므로 같은 쿼리 한 번으로 총계가 나온다
--    (별도 count 왕복 없음 = B4). 미리보기 행은 그대로 상한을 유지한다(명단은 3개만 표시).
--
-- ⚠️ 반환 컬럼이 늘어 create or replace가 불가(42P13) → drop 후 재생성. 0097a(세션)·0114a(cron) 둘 다.
--    권한 부여는 원본 마이그레이션과 동일하게 다시 건다(drop이 grant도 함께 지운다).
-- ⚠️ drizzle journal 밖(손수 alpha). 신규 DB는 pnpm db:alphas가 사전순 적용.

drop function if exists public.dashboard_unassigned_enrolled(int);
drop function if exists public.dashboard_unassigned_enrolled_admin(int, uuid);

-- ── 세션용(RLS·auth_tenant_id) ───────────────────────────────────────────────
create or replace function public.dashboard_unassigned_enrolled(p_limit int default 8)
returns table (student_id uuid, student_name text, grade text, school text, enrolled_at date, total_count bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select s.id, s.name, s.grade, s.school, s.enrolled_at, count(*) over () as total_count
  from students s
  where s.tenant_id = auth_tenant_id()
    and s.status = 'enrolled'
    and not exists (
      select 1 from enrollments e
      where e.student_id = s.id
        and (e.end_date is null or e.end_date >= current_date))
  order by s.enrolled_at desc nulls last
  limit p_limit;
$$;

comment on function public.dashboard_unassigned_enrolled(int) is
  '0097a 반 미배정 재원생(0159a: total_count 추가 — 미리보기 행은 p_limit로 잘려도 총계는 정확).';

-- ── cron(service_role) 변형 — auth_tenant_id() 대신 p_tenant ─────────────────
create or replace function public.dashboard_unassigned_enrolled_admin(p_limit int, p_tenant uuid)
returns table (student_id uuid, student_name text, grade text, school text, enrolled_at date, total_count bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select s.id, s.name, s.grade, s.school, s.enrolled_at, count(*) over () as total_count
  from students s
  where s.tenant_id = p_tenant
    and s.status = 'enrolled'
    and not exists (
      select 1 from enrollments e
      where e.student_id = s.id
        and (e.end_date is null or e.end_date >= current_date))
  order by s.enrolled_at desc nulls last
  limit p_limit;
$$;

revoke all on function public.dashboard_unassigned_enrolled_admin(int, uuid) from public;
revoke all on function public.dashboard_unassigned_enrolled_admin(int, uuid) from anon;
revoke all on function public.dashboard_unassigned_enrolled_admin(int, uuid) from authenticated;
grant execute on function public.dashboard_unassigned_enrolled_admin(int, uuid) to service_role;

comment on function public.dashboard_unassigned_enrolled_admin(int, uuid) is
  '0114a dashboard_unassigned_enrolled의 cron(service_role) 변형(0159a: total_count 추가). execute는 service_role만.';
