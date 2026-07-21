-- 0127a_onescreen_send_calendar.sql (손수 alpha)
-- 강사 원스크린 "월간 발송" 달력 — 내가 쓴 보고서를 날짜×발송상태로 집계한다.
-- 왜 RPC인가: 한 달치 보고서는 강사 한 명도 수백~1000행을 넘길 수 있어(하루 40건×22일 ≈ 880)
--   bare select로 받아 JS에서 세면 PostgREST 1000행 silent 절단에 걸린다(B2). 달력은 "센 값"이 곧
--   화면이라 절단되면 조용히 틀린 숫자가 뜬다 → group-by를 DB에서 끝내고 (날짜×상태) 수십 행만 받는다.
--   반환 행 수 상한 = 31일 × 상태 종류(~11) ≈ 341행이라 절단 사정권 밖.
-- 판정(발송/미발송/문제 버킷)은 앱 순수 함수(send-calendar.ts)가 한다 — RPC는 집계만(0124a와 동일 분업).
--   상태 문자열을 DB에서 버킷으로 접으면 배지 라벨(classnoteBadge)과 규약이 갈라진다.
-- 귀속 = teacher_name(저장 시 displayName 기록) — "지난 보고서"(history-actions)와 같은 기준이라
--   달력 숫자와 날짜 상세 목록이 어긋나지 않는다. 다른 강사 것은 애초에 조회되지 않음.
-- security invoker + auth_tenant_id() 이중격리(RLS가 1차, tenant 조건이 2차).
-- ⚠️ 출력 컬럼명을 원본 컬럼명(report_date/classnote_status)과 다르게 둔 이유: RETURNS TABLE의 출력
--   이름은 함수 본문에서도 유효해 같은 이름이면 컬럼 참조가 모호해진다.
-- ⚠️ drizzle journal 밖(손수 alpha) — pnpm db:alphas가 사전순 적용.

create or replace function onescreen_send_calendar(
  p_teacher_name text,
  p_from date,
  p_to date
)
returns table (
  report_day date,
  status_key text,   -- classnote_status 원문. 미발송(null)은 빈 문자열로 정규화(클라 버킷 판정 입력)
  cnt int
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    r.report_date as report_day,
    coalesce(r.classnote_status, '') as status_key,
    count(*)::int as cnt
  from lesson_reports r
  where r.tenant_id = auth_tenant_id()
    and r.teacher_name = p_teacher_name
    and r.report_date between p_from and p_to
  group by r.report_date, coalesce(r.classnote_status, '')
$$;
