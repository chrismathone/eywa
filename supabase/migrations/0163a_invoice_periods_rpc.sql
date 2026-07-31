-- ⚠️ 채번 충돌 2회 — 0159a(main의 unassigned_enrolled_total) → 0161a(main의 document_categories_and_links) → **0163a** (2026-07-31).
-- 수납 월 칩(청구월 목록) RPC — 전건 fetch + JS Set distinct를 DB group-by 1쿼리로 대체.
--
-- 배경(2026-07-31 실측): getAvailablePeriods가 invoices의 `period` 한 컬럼을 **전건** 페이징으로 긁고
-- 있었다. 지금 invoices는 3,225행 → **요청 4회 / 3,225행 / 245ms**를 매 수납 화면 렌더마다 지불하고,
-- 결과는 월 문자열 8개다. 게다가 행이 늘수록 1,000행마다 왕복이 하나씩 더 붙는다(≈2.5개월에 1회).
-- 전건을 받은 이유는 PostgREST에 distinct가 없어서였고(무페이징 select는 1000행 silent 절단, #54),
-- 그 회피가 fetchAllPaged였다 — CLAUDE.md B2가 말하는 "세거나·집계하려면 RPC"의 정확한 사례.
--
-- security invoker(호출자 RLS 적용) + 명시적 auth_tenant_id() 필터로 멀티테넌트 격리 이중 방어(0039a 패턴).
create or replace function public.invoice_periods()
returns table (period text)
language sql
stable
security invoker
set search_path = public
as $$
  select i.period
  from invoices i
  where i.tenant_id = auth_tenant_id()
  group by i.period
  order by i.period desc;
$$;

comment on function public.invoice_periods() is
  '수납 화면 월 선택 칩용 청구월 distinct 목록(최신순). 전건 fetch 금지(B2) — getAvailablePeriods가 호출.';
