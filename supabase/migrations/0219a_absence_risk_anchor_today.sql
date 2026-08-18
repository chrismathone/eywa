-- 0219a — 결석 위험 14일 창의 **기준일에 "오늘" 상한**을 건다 (미리 찍은 미래 결석이 창을 밀던 것)
--
-- 원장 2026-08-18: *"출석부에서 미래 출석에 미리 결석(여행, 개인사정 등)을 처리해놓으면 ecs 및 여러
-- 뷰에서 미리 결석 체크 연동되는지 확인"* → 확인 결과 표시는 전부 정상인데 **이 함수 하나가 오염된다.**
--
-- ■ 무엇이 문제였나
--   두 함수는 "최근 14일"의 기준일(anchor)을 `max(session_date)`로 잡는다. 데모 시절 출결이 과거에
--   몰려 있어 today 기준으로는 0건이 되던 것을 피하려던 장치인데, **오늘 상한이 없다.**
--   출석부는 미래 날짜 입력을 의도적으로 허용하므로(attendance/edit-window.ts: "미래 날짜는 막지 않는다
--   — 다음 수업을 미리 찍어두는 운영을 차단할 이유가 없다"), 여행 결석을 미리 찍는 순간 anchor가
--   그 미래 날짜로 끌려가고 14일 창이 통째로 앞으로 민다.
--
-- ■ 실측(프로덕션 injaewon, 2026-08-18 — 8/19·8/21에 "제주도 여행" 결석 5칸이 미리 찍힌 상태)
--   anchor 8/18 → 8/21 · 창 8/05~8/18 → 8/08~8/21
--   결석 위험 학생 **31명 → 13명**. 실제로 위험한 18명(박한비 7 · 김준서A 7 · 주준호 6 …)이 명단에서
--   사라지고, 여행 예정인 학생이 7회로 **명단 상단에** 올라왔다.
--
-- ■ 왜 급한가 — 이 함수를 셋이 쓴다
--   ① 대시보드 '결석 위험' 위젯  ② 일일 브리핑(매니저 팀 보고)  ③ **결석 마일스톤 알림**(master + 담당 강사).
--   즉 다음 크론에서 "여행 가는 학생이 반복 결석 위험"이라는 **사실이 아닌 알림**이 나가고, 정작 진짜
--   위험한 18명은 브리핑에서 빠진다. 숫자가 조용히 틀리는 종류라 화면만 봐서는 알 수 없다.
--
-- ■ 고침
--   anchor를 고를 때만 `session_date <= 오늘(KST)`로 좁힌다. **미리 찍는 운영은 그대로 둔다** —
--   위험 판정이 오늘까지만 보게 하는 것뿐이고, 그 날짜가 실제로 오면 자연히 창에 들어온다.
--   `effective`의 상한은 `anchor.d`라 anchor만 좁히면 미래 행은 자동으로 빠진다(상한을 두 곳에 적지 않는다).
--
-- 🔴 **`current_date`를 쓰지 말 것 — 이 DB의 timezone은 UTC다.** KST 00~09시엔 하루 어긋나
--    "어제까지만" 보게 된다(0124a에 같은 경고가 이미 있다). 기준일은 `(now() at time zone 'Asia/Seoul')::date`.
-- ⚠️ `stable` 유지 — `now()`는 트랜잭션 시각이라 stable이 맞다(immutable로 바꾸면 계획이 굳어 틀린다).
-- ⚠️ 시그니처·반환형 불변이라 앱은 옛 정의에서도 그대로 돈다(#95 expand/contract) — 적용 순서에 자유롭다.
-- ⚠️ 되돌리려면 0198a의 정의를 다시 실행하면 된다(이 파일은 그 위에 anchor 한 줄만 얹는다).

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
      -- 🔴 오늘(KST) 상한 — 미리 찍은 미래 결석이 창을 앞으로 밀지 않게(0219a).
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
    count(*) as absences
  from effective a
  join students s on s.id = a.student_id and s.tenant_id = a.tenant_id
  where a.status = 'absent'
  group by s.id, s.name
  having count(*) >= p_min
  order by absences desc;
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
      -- 🔴 오늘(KST) 상한 — 위 ①과 같은 이유(0219a).
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
    count(*) as absences
  from effective a
  join students s on s.id = a.student_id and s.tenant_id = a.tenant_id
  where a.status = 'absent'
  group by s.id, s.name
  having count(*) >= p_min
  order by absences desc;
$$;

comment on function public.dashboard_absence_risk(int) is
  '최근 유효 출결일(오늘 이하) 기준 14일 결석 위험: 학생·반·수업일·교시별 최신 행만 집계(0198a 교시 단위, 0219a 오늘 상한).';
comment on function public.dashboard_absence_risk_admin(int, uuid) is
  'dashboard_absence_risk의 cron(service_role) 변형 — auth_tenant_id() 대신 p_tenant. execute는 service_role만(0219a: 오늘 상한).';

notify pgrst, 'reload schema';
