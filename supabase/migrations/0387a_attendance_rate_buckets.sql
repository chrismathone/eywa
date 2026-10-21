-- 출결 등원율 추이 RPC(원장 2026-10-20 *"상세 눌렀을때 추이를 볼 수 없는곳 모두 추가해보자"*) — 출결 통계 화면(/attendance/stats)이
-- 칸(날 · 달)마다 **기록 칸 수 · 출석+지각 수**를 받는다. 12~24개월이면 기록이 수만 줄이라 전건 fetch + JS 집계 대신 DB group-by(B2).
-- 판정은 운영실 '최근 14일 등원율'과 같다:
--   · 같은 칸(학생·반·수업일·교시)의 정정은 **최신 한 줄**만(`effectiveAttendanceRecords` — recorded_at 최신(밀리초), 같으면 id 큰 쪽).
--   · 분자 = 출석 + 지각(`ATTENDED_STATUSES` — 보강·조퇴·공결은 아니다) · 분모 = 기록 칸 전부(명단·반 필터 없음 — 운영실과 같다).
-- 과목 관리자 값을 위해 반 과목을 함께 돌려준다(반이 없으면 null).
-- security invoker(호출자 RLS) + 명시적 auth_tenant_id()로 지점 격리 이중 방어(0039a·0040a 패턴).
create or replace function public.attendance_rate_buckets(p_from date, p_to date, p_grain text)
returns table (bucket text, subject text, total bigint, attended bigint)
language sql
stable
security invoker
set search_path = public
as $$
  with eff as (
    select distinct on (student_id, class_id, session_date, coalesce(slot_start::text, ''))
      class_id, session_date, status::text as status
    from attendance_records
    where tenant_id = auth_tenant_id()
      and session_date between p_from and p_to
    -- 시각은 밀리초까지만 견준다 — 운영실(`effectiveAttendanceRecords`)이 Date.parse로 밀리초까지만 보므로 같은 밀리초 안의 두 정정은
    -- id 큰 쪽(리뷰 2026-10-20: 마이크로초 차이로 운영실과 다른 줄을 고르면 그 칸의 등원율이 0% ↔ 100%로 갈린다).
    order by student_id, class_id, session_date, coalesce(slot_start::text, ''), date_trunc('milliseconds', recorded_at) desc, id desc
  )
  select
    case when p_grain = 'day' then to_char(e.session_date, 'YYYY-MM-DD') else to_char(e.session_date, 'YYYY-MM') end as bucket,
    c.subject,
    count(*) as total,
    count(*) filter (where e.status in ('present', 'late')) as attended
  from eff e
  left join classes c on c.id = e.class_id
  group by 1, 2;
$$;

-- 운영 콘솔 '원장 화면 열기'(0356a) 중에도 읽을 수 있게 — 앱 쪽 읽기 목록(`TENANT_VIEW_READ_RPCS`)에 같은 이름을 올렸다(stable 함수만).
