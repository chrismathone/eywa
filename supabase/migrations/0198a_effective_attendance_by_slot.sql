-- 0198a — '유효 출결 1건' 판정에 **교시**를 넣는다 (0196a 후속, RPC 4곳)
--
-- 0196a로 출결이 교시별로 쌓이기 시작했는데, 집계 RPC들은 아직 (학생·반·**날짜**)로 접는다.
-- 그대로 두면 같은 날 4교시·6교시 중 **한 건만 세고 나머지는 조용히 사라진다** — 화면엔 둘 다 찍혀
-- 있는데 청구 소비·결석 집계는 하나로 잡히는, 눈에 안 보이는 어긋남이다.
--
-- 바꾸는 것은 `distinct on`(+ `order by`)의 키 하나뿐이다. 본문·권한·주석은 원본 그대로.
--   0103a+0115a session_term_attendance (회차 소비 시수 합 — 0115a가 같은 이름을 numeric으로 교체했다)
--   0110a dashboard_absence_risk       (14일 결석)
--   0114a dashboard_absence_risk_admin (같은 것의 cron 변형)
--
-- ⚠️ **지금 적용해도 숫자는 안 바뀐다** — 이 시점 출결 6,540행이 전부 slot_start null이라 그룹이
--    쪼개지지 않는다. 교시별 기록이 쌓이는 앞으로의 날짜부터 달라진다.
-- 🔴 앞으로 달라지는 것(원장 승인 2026-08-10 "제한 없어"): 하루 2교시 반은 그 날 **2건·2시수**로
--    잡힌다 = 회차제 청구의 소비가 하루 2회, 14일 결석 카운트도 교시 단위. "1교시 = 1회"라는
--    원장 규칙의 직접적 귀결이다.
-- ⚠️ null끼리도 한 그룹으로 접혀야 옛 기록이 흩어지지 않는다 — `distinct on`은 null을 서로 같게 보므로
--    (`is not distinct from`과 같은 취급) 그대로 두면 된다.
--
-- 롤백 = 각 원본 파일(0103a·0110a·0114a·0115a) 본문으로 재생성.
set local statement_timeout = '60s';

-- ① 0103a+0115a — 회차 소비(시수 합). ⚠️ 0115a가 **같은 이름**을 numeric으로 drop 후
--    재생성했으므로 살아 있는 함수는 이것 하나뿐이다(0103a의 int 버전을 되살리면 회귀).
create or replace function public.session_term_attendance(p_period text)
returns table (invoice_id uuid, class_id uuid, consumed numeric)
language sql
stable
security invoker
set search_path = public
as $$
  with terms as (
    select st.invoice_id, st.class_id, i.student_id
    from invoice_session_terms st
    join invoices i on i.id = st.invoice_id and i.tenant_id = st.tenant_id
    where st.tenant_id = auth_tenant_id()
      and i.period = p_period
  ),
  eff as (
    -- (학생·반·날짜·교시)별 최신 기록만 = supersedes 정정 반영(dedup). 0198a에서 교시 추가.
    select distinct on (ar.student_id, ar.class_id, ar.session_date, ar.slot_start)
      ar.student_id, ar.class_id, ar.status, ar.session_units
    from attendance_records ar
    where ar.tenant_id = auth_tenant_id()
      and to_char(ar.session_date, 'YYYY-MM') = p_period
    order by ar.student_id, ar.class_id, ar.session_date, ar.slot_start, ar.recorded_at desc
  )
  select
    t.invoice_id,
    t.class_id,
    -- 시수 합(배수 합) — null 셀은 기본 1. 소비 인정 상태는 0103a와 동일.
    coalesce(
      sum(coalesce(e.session_units, 1)) filter (
        where e.status in ('present', 'late', 'early_leave', 'makeup')
      ),
      0
    )::numeric(6,1) as consumed
  from terms t
  left join eff e on e.student_id = t.student_id and e.class_id = t.class_id
  group by t.invoice_id, t.class_id
  order by t.invoice_id, t.class_id;  -- .range() 페이징 안정성
$$;

-- ③ 0110a — 14일 결석 위험(로그인 사용자)
create or replace function public.dashboard_absence_risk(p_min int default 3)
returns table (student_id uuid, student_name text, absences bigint)
language sql
stable
security invoker
set search_path = public
as $$
  with anchor as (
    select max(session_date) as d
    from attendance_records
    where tenant_id = auth_tenant_id()
  ),
  effective as (
    select distinct on (a.student_id, a.class_id, a.session_date, a.slot_start)
      a.tenant_id,
      a.student_id,
      a.class_id,
      a.session_date,
      a.status
    from attendance_records a
    cross join anchor
    where a.tenant_id = auth_tenant_id()
      and anchor.d is not null
      and a.session_date >= anchor.d - interval '13 days'
      and a.session_date <= anchor.d
    order by a.student_id, a.class_id, a.session_date, a.slot_start, a.recorded_at desc, a.id desc
  )
  select
    s.id as student_id,
    s.name as student_name,
    count(*) as absences
  from effective a
  join students s on s.id = a.student_id and s.tenant_id = a.tenant_id
  where a.status = 'absent'
  group by s.id, s.name
  having count(*) >= p_min
  order by absences desc;
$$;

-- ④ 0114a — 같은 것의 cron(service_role) 변형
create or replace function public.dashboard_absence_risk_admin(p_min int, p_tenant uuid)
returns table (student_id uuid, student_name text, absences bigint)
language sql
stable
security invoker
set search_path = public
as $$
  with anchor as (
    select max(session_date) as d
    from attendance_records
    where tenant_id = p_tenant
  ),
  effective as (
    select distinct on (a.student_id, a.class_id, a.session_date, a.slot_start)
      a.tenant_id,
      a.student_id,
      a.class_id,
      a.session_date,
      a.status
    from attendance_records a
    cross join anchor
    where a.tenant_id = p_tenant
      and anchor.d is not null
      and a.session_date >= anchor.d - interval '13 days'
      and a.session_date <= anchor.d
    order by a.student_id, a.class_id, a.session_date, a.slot_start, a.recorded_at desc, a.id desc
  )
  select
    s.id as student_id,
    s.name as student_name,
    count(*) as absences
  from effective a
  join students s on s.id = a.student_id and s.tenant_id = a.tenant_id
  where a.status = 'absent'
  group by s.id, s.name
  having count(*) >= p_min
  order by absences desc;
$$;

comment on function public.session_term_attendance(text) is
  '시수 검증(read-only): 청구월 회차 확정 행별 실 소비 시수 합(유효=학생·반·날짜·교시별 최신, session_units null=1, 상태 present/late/early_leave/makeup). 0198a부터 교시 단위. docs/per-session-billing-plan.md';
comment on function public.dashboard_absence_risk(int) is
  '최근 유효 출결일 기준 14일 결석 위험: 학생·반·수업일·교시별 최신 recorded_at, 동률이면 id 내림차순 행만 집계(0198a).';
comment on function public.dashboard_absence_risk_admin(int, uuid) is
  '0110a dashboard_absence_risk의 cron(service_role) 변형 — auth_tenant_id() 대신 p_tenant. execute는 service_role만(0198a: 교시 단위).';

notify pgrst, 'reload schema';
