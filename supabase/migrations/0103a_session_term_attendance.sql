-- 0103a: 시수 검증(read-only) — 회차 확정 N(청구값) 대비 실 소비 출석 카운트 RPC.
-- 설계 = docs/per-session-billing-plan.md "시수 검증(a) read-only 탭"(로드맵 2단계, 청구=N회 키스톤 직접 소비자).
-- ⚠️ 읽기 전용(데이터 mutation 0). 확정값(confirmed_sessions)과 실 출석 diff는 점검 신호일 뿐 — 자동 수정 없음(N2).
--
-- attendance_records는 append-only(supersedes_id) → (학생·반·날짜)별 최신 recorded_at 1건만 유효(dedup, distinct on).
-- 소비 인정 상태 = present·late·early_leave·makeup. absent 제외, excused=폐지된 결석 별칭이라 제외(2026-07-09 통일).
-- 청구월 ≈ 달력월 근사(v1 한계, plan 명시): to_char(session_date,'YYYY-MM') = period. 기간 ranges 모델 미도입.
--
-- term 중심(invoice_id·class_id 반환)이라 결과 크기 = 그 달 회차 확정 행 수(session_terms)와 1:1 —
-- 테넌트 전체 출석 pair가 아니라 청구 대상만 → 결과 축소. 호출부는 fetchAllPaged로 페이징(B2 절단 방어).
-- security invoker + auth_tenant_id() 명시 필터 = RLS와 이중격리(0101a 패턴).

create or replace function public.session_term_attendance(p_period text)
returns table (invoice_id uuid, class_id uuid, consumed int)
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
      ar.student_id, ar.class_id, ar.status
    from attendance_records ar
    where ar.tenant_id = auth_tenant_id()
      and to_char(ar.session_date, 'YYYY-MM') = p_period
    order by ar.student_id, ar.class_id, ar.session_date, ar.recorded_at desc
  )
  select
    t.invoice_id,
    t.class_id,
    count(*) filter (
      where e.status in ('present', 'late', 'early_leave', 'makeup')
    )::int as consumed
  from terms t
  left join eff e on e.student_id = t.student_id and e.class_id = t.class_id
  group by t.invoice_id, t.class_id
  order by t.invoice_id, t.class_id;  -- .range() 페이징 안정성
$$;

comment on function public.session_term_attendance(text) is
  '시수 검증(read-only): 청구월 회차 확정 행별 실 소비 출석 수(유효=학생·반·날짜별 최신, 상태 present/late/early_leave/makeup). docs/per-session-billing-plan.md';
