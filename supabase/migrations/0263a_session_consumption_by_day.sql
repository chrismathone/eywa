-- 0263a — 회차(N회) 청구 소비는 **출석 '하루 = 1회'** 로 센다 (0198a 후속, RPC 1곳)
--
-- 원장 2026-09-14: *"9회 계획이 18일 출석으로 읽히면 안되지. 하루하루를 1일로 세어야지"* ·
-- *"하루에 3개 수업을 들으면 출석을 3회 카운트해야겠지만, 영어처럼 1개의 수업 내에서 3개로 쪼개진
--   수업을 들었다고해서 출석을 3회로 카운트하면 안되지"*.
--
-- 종전 `session_term_attendance`는 소비를 **시수 합**(`sum(coalesce(session_units, 1))`)으로 셌다.
-- 시수는 "수업을 얼마나 했나"(출석부·급여)이지 "몇 회를 썼나"가 아니라서 같은 사실이 세 방향으로 어긋났다:
--   · 1교시 반(교시 하나당 0.5, 2026-09-14 배포) → 9회 계획이 **18일**로 읽힌다.
--   · 3시간 반(1.5)                              → 9회 계획이 **6일**에 소진된다.
--   · 영어(하루 2~4교시)                          → 0198a가 교시별로 접기 시작하면서 하루가 **2~4회**로 세진다.
--
-- 바꾸는 것은 집계 한 줄뿐이다 — `sum(시수)` → `count(distinct session_date)`.
-- 🔑 세는 단위 `(invoice_id, class_id)`(= 학생 × 반)는 **그대로**라 원장 규칙이 그대로 성립한다:
--    다른 반 3개를 들으면 반마다 1회씩 **3회**, 한 반이 하루에 몇 교시로 쪼개졌든 그날은 **1회**.
--
-- ⚠️ `eff`의 select에 **`ar.session_date`를 더했다** — 0198a 본문엔 이 컬럼이 없어서(그때는 세지 않았다)
--    그대로 두면 바깥에서 날짜로 셀 수가 없다. dedup 키·order by는 한 글자도 안 바꿨다.
-- ⚠️ 교시별 dedup(0198a)은 **그대로 둔다** — 그건 정정 이력(supersedes)을 접는 장치이지 세는 단위가 아니다.
--    날짜로 접어 세는 일은 바깥 `count(distinct ...)`이 한다.
-- 🔴 **시수(`session_units`)는 손대지 않는다** — 출석부·급여가 쓰는 값이고 원장이 *"출석부는 그렇게 세는게 맞아"* 로
--    확인했다. 이 파일은 **회차 세는 법**만 바꾼다.
--
-- ⚠️ 적용해도 **지금 돈은 안 바뀐다**(실측 2026-09-14, 읽기 전용):
--    `invoice_session_terms` 1,960행이 **전부 미확정**(`confirmed_sessions` 있는 행 0) ·
--    `invoice_teacher_splits` **0행** · `session_term_confirm*` 감사로그 **0건**.
--    지금 달라지는 것은 시수 검증 화면의 '실 소비' 숫자뿐이고, 회차 확정을 시작하는 순간부터 이 값이 청구 판정에 쓰인다.
--    (참고 실측 — **이 함수와 같은 범위**(terms 조인 = 청구 대상만), 2026-09-14 15:37 KST:
--     2026-08 영어 소비 합 2,940 → 1,264 · 수학 1,683 → 1,558 / 2026-09 영어 1,965 → 985 · 수학 1,129.5 → 999.
--     판정 전이는 전부 미확정이라 0건. ⚠️ 청구 term과 조인하지 않고 그 달 출결 전체를 더하면 다른 숫자가 나온다
--     — 그건 화면에 뜨는 값이 아니다.)
--
-- ⚠️ 알려진 경계 — **보강이 정규와 같은 날이면 따로 안 세진다**(그날 그 반은 1회).
--    실측 1건(2026-09-14 기준): 2026-09-10 홍채민 · 중등E_초6 SKY = 보강 2교시(각 시수 2.0) + 정규 1교시,
--    옛 5.0 → 새 1. 원장 지시("한 반의 쪼개진 수업 = 1회")와는 맞지만 "빠진 회차를 채우는 보강"은 논의에 없었다
--    — 회차 확정을 켜기 전 원장 확인 필요(확정을 시작하면 이 학생이 '부족'으로 잡힌다).
--
-- 롤백 = 0198a ①번 블록 본문으로 재생성(`sum(coalesce(e.session_units, 1))` + `eff`에서 session_date 제거).
set local statement_timeout = '60s';

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
    -- 0263a에서 session_date를 select에 추가 — 바깥에서 **날짜 수**를 세야 하기 때문이다.
    select distinct on (ar.student_id, ar.class_id, ar.session_date, ar.slot_start)
      ar.student_id, ar.class_id, ar.session_date, ar.status, ar.session_units
    from attendance_records ar
    where ar.tenant_id = auth_tenant_id()
      and to_char(ar.session_date, 'YYYY-MM') = p_period
    order by ar.student_id, ar.class_id, ar.session_date, ar.slot_start, ar.recorded_at desc
  )
  select
    t.invoice_id,
    t.class_id,
    -- 출석 **일수** — 그날 소비 인정 기록이 하나라도 있으면 1회(교시가 몇 개든). 상태 기준은 0103a와 동일.
    -- ⚠️ coalesce는 옛 `sum` 식에서 물려받은 방어적 관용구다 — `count()`는 빈 그룹에도 NULL을 주지 않아
    --    사실상 죽은 코드다(left join 무매칭도 실제로 0을 낸다). 무해해서 그대로 두지만 되짚지 말 것.
    coalesce(
      count(distinct e.session_date) filter (
        where e.status in ('present', 'late', 'early_leave', 'makeup')
      ),
      0
    )::numeric(6,1) as consumed
  from terms t
  left join eff e on e.student_id = t.student_id and e.class_id = t.class_id
  group by t.invoice_id, t.class_id
  order by t.invoice_id, t.class_id;  -- .range() 페이징 안정성
$$;

comment on function public.session_term_attendance(text) is
  '회차 소비 검증(read-only): 청구월 회차 확정 행별 실 소비 **회차 수** = 출석 일수(학생×반 기준, 하루에 몇 교시든 1회). 유효 기록은 학생·반·날짜·교시별 최신, 상태 present/late/early_leave/makeup. 0263a부터 일수(그 전에는 시수 합). docs/per-session-billing-plan.md';
