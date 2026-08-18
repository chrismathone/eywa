-- 0221a — 결석 위험 "N회"를 **교시 수가 아니라 반·하루 수**로 센다
--
-- 원장 2026-08-18 (측정 결과를 보고 "B" 선택).
--
-- ■ 무엇이 문제였나
--   0196a 이후 **영어는 교시마다 출결 행**을 남긴다(수학은 하루치 한 행 그대로). 그런데 위험 집계는
--   행을 그냥 세고 있어서, 같은 "하루 결석"이 과목에 따라 다른 숫자가 됐다.
--   실측(2026-08-18, 14일 창 216행): 수학 87일→87회(배수 1.00) / 영어 59일→129회(**배수 2.19**).
--   즉 "최근 14일 3회"라는 문턱이 수학에겐 3일, 영어에겐 1~2일이었다 — 아무도 정한 적 없는 정책이고
--   저장 형식이 만든 차이다.
--
-- ■ 얼마나 부풀었나
--   위험 학생 **32명 → 17명**. 17명이 순전히 교시 셈법으로 명단에 있었고, 그중 9명(김준영·김나연·
--   추연우·박서현·박수찬·남은우·김시율·박서연D·이서은)은 **하루 결석 1회**인데 3교시라 3회로 세어져
--   "반복 결석 위험"으로 원장 대시보드와 담당 강사 알림에 올라와 있었다.
--
-- ■ 고침 — `count(*)` → `count(distinct (class_id, session_date))`
--   · 세는 단위 = **그 반에서 결석한 날**. 다른 날 세 번 빠진 것과 하루에 세 교시 빠진 것을 구분한다.
--   · `effective`의 `distinct on (…, slot_start)`는 **그대로 둔다** — 그건 "교시별 최신 정정 1건"을
--     고르는 장치이지 세는 단위가 아니다(빼면 옛 정정 행이 되살아난다).
--   · 🔑 같은 날 **다른 반**을 빠진 건 따로 센다(2회). "안 온 날"이 아니라 "빠진 수업"을 세는 것이다 —
--     하루 단위로 뭉치면(원장 검토 시 'C안') 수학은 왔는데 영어만 빠진 날이 지워진다.
--   · 수학은 **숫자가 하나도 안 변한다**(실측 87 = 87) — 영어만 정상화된다.
--
-- ■ 문턱은 3 그대로
--   2주에 세 번 수업을 빠진 것은 그 자체로 눈에 걸릴 만하다(원장 확인). 명단은 32 → 17명이 되고,
--   남는 17명은 과목과 무관하게 같은 뜻을 갖는다.
--
-- ⚠️ 0220a의 **오늘(KST) 상한은 그대로 유지**한다(미리 찍은 미래 결석이 14일 창을 밀던 것).
--    `current_date`를 쓰지 말 것 — 이 DB의 timezone은 UTC라 KST 00~09시에 하루 어긋난다.
-- ⚠️ 시그니처·반환형 불변이라 앱은 옛 정의에서도 그대로 돈다(#95) — 적용 순서에 자유롭다.
-- ⚠️ 이미 나간 마일스톤 알림은 취소되지 않는다(dedup은 tier 기준). 숫자가 내려가도 조용해질 뿐이고,
--    새 기준으로 다시 tier에 도달하는 사람만 울린다.

-- ① 로그인 사용자용(security invoker + auth_tenant_id 이중 격리)
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
      -- 오늘(KST) 상한 — 미리 찍은 미래 결석이 창을 앞으로 밀지 않게(0220a).
      and session_date <= (now() at time zone 'Asia/Seoul')::date
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
    -- 🔴 교시 수가 아니라 **반·하루** 수(0221a). 영어는 하루가 2~3행이라 그냥 세면 2.19배가 된다.
    count(distinct (a.class_id, a.session_date)) as absences
  from effective a
  join students s on s.id = a.student_id and s.tenant_id = a.tenant_id
  where a.status = 'absent'
  group by s.id, s.name
  having count(distinct (a.class_id, a.session_date)) >= p_min
  order by count(distinct (a.class_id, a.session_date)) desc;
$$;

-- ② cron(service_role) 변형 — 브리핑·결석 마일스톤 알림이 이걸 쓴다
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
      -- 오늘(KST) 상한 — 위 ①과 같은 이유(0220a).
      and session_date <= (now() at time zone 'Asia/Seoul')::date
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
    -- 🔴 위 ①과 같은 셈법(0221a) — 두 함수가 갈리면 화면과 알림이 서로 다른 숫자를 말한다.
    count(distinct (a.class_id, a.session_date)) as absences
  from effective a
  join students s on s.id = a.student_id and s.tenant_id = a.tenant_id
  where a.status = 'absent'
  group by s.id, s.name
  having count(distinct (a.class_id, a.session_date)) >= p_min
  order by count(distinct (a.class_id, a.session_date)) desc;
$$;

-- ③ 🌱 **강등된 학생만 무발송 시드** — 셈법이 바뀌어 숫자가 내려가는데 새 알림이 튀는 것을 막는다.
--
-- 🔴 왜 필요한가: 마일스톤 dedup은 `(학생, tier)` 버킷이라, 전에 tier 5·10으로 울린 학생이 이번 변경으로
--    tier 3이 되면 **"3" 버킷이 처음 생기면서 새 알림이 나간다.** 상황이 나아졌는데 벨이 울리는 꼴이다.
--    실측 대상 7명: 김수민(10→4) · 전주율(10→4) · 주준호 · 하은결 · 김수아 · 윤정원 · 이준형.
--
-- 🔑 **강등만 시드한다**(이전 최고 tier > 새 tier). 전원 시드하면 엄채율처럼 **이전 기록이 없는 정당한
--    첫 알림까지** 삼킨다 — 그 학생은 실제로 지금 3회이고 아직 아무도 모른다.
-- ⚠️ `on conflict do nothing`이라 이미 그 버킷이 있으면 아무 일도 없다(멱등 — 여러 번 실행해도 안전).
-- ⚠️ `seeded = true`로 남겨 "울려서 생긴 행"과 구분한다(콜드스타트 시드와 같은 표기).
-- ⚠️ bucket을 int로 캐스팅하므로 **event_type을 반드시 좁힌다** — 다른 이벤트의 버킷은 숫자가 아니다.
insert into notification_events (tenant_id, event_type, subject_key, bucket, seeded)
select t.id, 'absence_alert', r.student_id::text, x.new_tier, true
from tenants t
cross join lateral public.dashboard_absence_risk_admin(3, t.id) r
cross join lateral (
  select case when r.absences >= 10 then '10' when r.absences >= 5 then '5' else '3' end as new_tier
) x
where exists (
  select 1
  from notification_events e
  where e.tenant_id = t.id
    and e.event_type = 'absence_alert'
    and e.subject_key = r.student_id::text
    and e.bucket ~ '^[0-9]+$'
    and e.bucket::int > x.new_tier::int
)
on conflict (tenant_id, event_type, subject_key, bucket) do nothing;

comment on function public.dashboard_absence_risk(int) is
  '최근 유효 출결일(오늘 이하) 기준 14일 결석 위험. 세는 단위 = 반·하루(0221a — 교시 수가 아니다). 유효행은 학생·반·수업일·교시별 최신(0198a), 기준일 오늘 상한(0220a).';
comment on function public.dashboard_absence_risk_admin(int, uuid) is
  'dashboard_absence_risk의 cron(service_role) 변형 — auth_tenant_id() 대신 p_tenant. 세는 단위 = 반·하루(0221a).';

notify pgrst, 'reload schema';
