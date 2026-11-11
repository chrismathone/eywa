-- s2_0045_restore_lesson_report_class_options.sql — 수업보고서 목록 '반' 필터 함수 되살리기 · 2026-11-11
--
-- 왜: 운영 로그(2026-11-10)에 `/lesson-reports`가 PGRST202 — `lesson_report_class_options(p_since)`가 운영 DB에 **없다**.
--     시즌1 합본(`s1_season1.sql#0147a_lesson_report_class_options.sql`)에는 정의가 있지만 운영에 적용된 적이 없었다
--     (운영엔 짝 함수 `lesson_report_filter_options`만 있음 · 2026-11-11 pg_proc 확인). 앱은 fail-soft라 반 드롭다운만 비어 있었다.
--     운영 lesson_reports 32,838행 중 반이 붙은 행 21,013 · 최근 60일 6,337 → 전건 select로는 1,000행에서 잘린다(B2) — RPC가 맞다.
--
-- 무엇: 0147a 본문 그대로(서명 `(p_since date) → (class_id uuid, class_name text)` · stable · security invoker ·
--       lesson_reports·classes 둘 다 `auth_tenant_id()`로 이중 격리). 바뀐 것은 둘뿐:
--   ① 표·함수 이름을 `public.`으로 적었다(search_path 의존 줄이기 — set search_path는 0147a·짝 함수와 같게 둔다.
--      이 함수는 안에서 날짜·지점을 다 거르므로 계획기 펼침(inline)에 기대지 않는다).
--   ② 실행권을 기본값에 맡기지 않고 명시한다 — PUBLIC·anon 회수, authenticated·service_role만.
--      (0147a는 기본 권한에 맡겼다 — 짝 함수는 그래서 anon까지 열려 있다. 이 함수는 로그인한 사용자의 수업보고서 목록 화면에서만 부른다.)
-- 운영자 '원장 화면 열기'(0356a): `auth_tenant_id()`가 읽기 전용 보기의 지점을 돌려주므로 따로 할 일 없음 ·
--   `src/lib/supabase/tenant-view-guard.ts`의 읽기 RPC 목록에 이미 있다.
-- 연동 역할 실행권 확인: lesson_report_class_options = 수업보고서 목록 화면(report-admin queries) 하나만 부른다 · RLS 정책·연동 PC 질의(scripts/_classnote 등)에서 부르지 않는다(2026-11-11 grep) · 운영에 없던 함수라 지금 실행 중인 호출자도 없다
--
-- 되돌리기: drop function if exists public.lesson_report_class_options(date);  (앱은 함수가 없으면 반 드롭다운만 빈다)

begin;
set local lock_timeout = '5s';

create or replace function public.lesson_report_class_options(p_since date)
returns table (class_id uuid, class_name text)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct r.class_id, c.class_name
  from public.lesson_reports r
  join public.classes c
    on c.id = r.class_id
   and c.tenant_id = public.auth_tenant_id()
  where r.tenant_id = public.auth_tenant_id()
    and r.report_date >= p_since
    and r.class_id is not null
  order by c.class_name;
$$;

revoke all on function public.lesson_report_class_options(date) from public, anon;
grant execute on function public.lesson_report_class_options(date) to authenticated, service_role;

commit;

-- PostgREST가 새 함수를 알아보게(빼먹으면 PGRST202가 계속 난다).
notify pgrst, 'reload schema';
