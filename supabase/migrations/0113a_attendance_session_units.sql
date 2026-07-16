-- 0113a: 출석 시수(배수) — attendance_records.session_units + 시수 검증 RPC를 '행 수'에서 '시수 합'으로.
--
-- 배경(2026-07-16 원장 지시): 구 출석부(D:\attendance)는 셀에 "정규 수업 1회 기준 배수"를 숫자로 적었다
-- (2시간 수업 기준: 정규 출석 1, 3시간 1.5, 보강 4시간 2 / 영어는 유닛당 1 — EiE 40분 유닛, 인재원 2시간 유닛).
-- eywa는 상태(enum)만 기록해 하루≠1회(보강 연장·부분 출석)를 표현하지 못했고, 시수 검증(0103a)의
-- 실 소비가 과소/과대 집계될 수 있었다. 셀당 배수 1개를 추가해 청구=N회 모델(회당 단가×N)과 단위를 통일한다.
--
-- 호환성(행동 불변): session_units는 nullable이며 null = 기본 배수 1. 기존 데이터는 전부 null이므로
-- sum(coalesce(session_units, 1)) == count(*) — RPC 교체 직후에도 기존 결과값과 동일하다.
-- 롤백 = 이 함수를 0103a 본문으로 재생성 + alter table drop column session_units.

alter table attendance_records
  add column if not exists session_units numeric(4,1)
  constraint attendance_session_units_range check (
    session_units is null or (session_units > 0 and session_units <= 20)
  );

comment on column attendance_records.session_units is
  '시수(정규 수업 1회 기준 배수). null=1(기본). 보강 연장=1.5/2, 부분 출석=0.5 등. absent에는 무의미(소비 집계는 present/late/early_leave/makeup만).';

-- 반환형 변경(consumed int → numeric)이라 create or replace 불가 — drop 후 재생성.
drop function if exists public.session_term_attendance(text);

create function public.session_term_attendance(p_period text)
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
    -- (학생·반·날짜)별 최신 기록만 = supersedes 정정 반영(dedup)
    select distinct on (ar.student_id, ar.class_id, ar.session_date)
      ar.student_id, ar.class_id, ar.status, ar.session_units
    from attendance_records ar
    where ar.tenant_id = auth_tenant_id()
      and to_char(ar.session_date, 'YYYY-MM') = p_period
    order by ar.student_id, ar.class_id, ar.session_date, ar.recorded_at desc
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

comment on function public.session_term_attendance(text) is
  '시수 검증(read-only): 청구월 회차 확정 행별 실 소비 시수 합(유효=학생·반·날짜별 최신, 상태 present/late/early_leave/makeup, session_units null=1). docs/per-session-billing-plan.md';
