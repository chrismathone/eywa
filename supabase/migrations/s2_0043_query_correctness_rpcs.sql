-- s2_0043_query_correctness_rpcs.sql — 조회 정확성 함수 셋 · 2026-11-10 · 수정 계획 P2-R(B3·B11·B16)
--
-- ① search_student_consultations(p_term) — 원생상담 검색(요약 OR 학생 이름)을 DB 안에서 잇는다(B3).
--    예전: 이름이 맞는 학생 id를 **전부** `student_id.in.(...)`으로 주소에 실었다 → '김'처럼 흔한 글자면 주소가 길어져
--    실패하고, 실패는 "상담 0건"으로 보였다. 이 함수는 표(student_consultations) 모양을 그대로 돌려줘 PostgREST가
--    필터·정렬·페이지·count·임베드(반 이름)를 종전처럼 얹는다.
--    security invoker — student_consultations·students RLS가 그대로 걸린다(강사는 제 지점 행만).
--    🔴 `set search_path`를 붙이지 않는다 — SET이 붙은 SQL 함수는 계획기가 펼치지(inline) 못해 지점 전체를 먼저 다 만든 뒤에야
--       필터·페이지가 얹힌다(적대 리뷰). 이름은 전부 `public.`으로 적었다. EXPLAIN에 Function Scan이 아니라 표 스캔이 보여야 한다.
--
-- ② share_link_view_counts(p_report_ids) — 보고서별 학부모 열람 수를 DB에서 센다(B11).
--    예전: 열람 행을 청크로 받아 JS로 셌다 → 한 청크가 1,000행을 넘으면 조용히 적게 나왔다(#54).
--    security invoker — share_link_views RLS(제 지점) 그대로. 본문(POST)이라 id가 많아도 주소 한도와 무관.
--
-- ③ ui_prefs_patch(...) — users.ui_prefs의 한 네임스페이스를 **한 문장으로** 고친다(B16).
--    예전: ui_prefs 전체를 읽고 JS에서 합친 뒤 통째로 다시 썼다 → 창 두 개에서 동시에 저장하면 다른 화면의 설정이 사라졌다.
--    p_replace=false: 그 네임스페이스 객체에서 p_unset 키를 지우고 p_set을 덮는다(키 단위).
--    p_replace=true : 그 네임스페이스 값을 p_set으로 바꾼다(네임스페이스 단위 — 다른 네임스페이스는 안 건드린다).
--    결과가 빈 객체이거나 p_set이 null(SQL null · JSON null — 교체)이면 네임스페이스 자체를 지운다.
--    서버(service_role)만 부른다 — 사용자 id를 인자로 받으므로 사용자 역할에 열지 않는다.
--
-- 옛 앱·새 앱 둘 다 돈다: 새 앱은 함수가 없으면(42883) 종전 경로로 돌아간다(#95). 되돌리기 = 아래 함수 셋 drop.

begin;
set local lock_timeout = '5s';

create or replace function public.search_student_consultations(p_term text)
returns setof public.student_consultations
language sql
stable
security invoker
as $$
  with t as (
    select '%' || replace(replace(replace(coalesce(p_term, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat
  )
  select c.*
  from public.student_consultations c, t
  where c.summary ilike t.pat
     or exists (
       select 1 from public.students s
       where s.id = c.student_id and s.tenant_id = c.tenant_id and s.name ilike t.pat
     )
$$;

create or replace function public.share_link_view_counts(p_report_ids uuid[])
returns table (lesson_report_id uuid, views bigint)
language sql
stable
security invoker
as $$
  select v.lesson_report_id, count(*)::bigint
  from public.share_link_views v
  where v.lesson_report_id = any(coalesce(p_report_ids, '{}'))
  group by v.lesson_report_id
$$;

create or replace function public.ui_prefs_patch(
  p_user uuid,
  p_tenant uuid,
  p_ns text,
  p_set jsonb,
  p_unset text[] default '{}',
  p_replace boolean default false
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  n int;
begin
  if p_ns is null or p_ns = '' then
    raise exception 'ui_prefs_patch: 네임스페이스가 비었습니다';
  end if;
  update public.users u
  set ui_prefs = (
    with base as (
      select case when jsonb_typeof(u.ui_prefs) = 'object' then u.ui_prefs else '{}'::jsonb end as root
    ), scope as (
      select root,
        case
          when p_replace then p_set
          else (
            (case when jsonb_typeof(root -> p_ns) = 'object' then root -> p_ns else '{}'::jsonb end)
            - coalesce(p_unset, '{}')
          ) || (case when jsonb_typeof(p_set) = 'object' then p_set else '{}'::jsonb end)
        end as v
      from base
    )
    select case
      when v is null or jsonb_typeof(v) = 'null' or v = '{}'::jsonb then root - p_ns
      else jsonb_set(root, array[p_ns], v, true)
    end
    from scope
  )
  where u.id = p_user and u.tenant_id = p_tenant;
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

revoke all on function public.ui_prefs_patch(uuid, uuid, text, jsonb, text[], boolean) from public, anon, authenticated;
grant execute on function public.ui_prefs_patch(uuid, uuid, text, jsonb, text[], boolean) to service_role;

revoke all on function public.search_student_consultations(text) from public, anon;
revoke all on function public.share_link_view_counts(uuid[]) from public, anon;
grant execute on function public.search_student_consultations(text) to authenticated, service_role;
grant execute on function public.share_link_view_counts(uuid[]) to authenticated, service_role;

commit;

notify pgrst, 'reload schema';
