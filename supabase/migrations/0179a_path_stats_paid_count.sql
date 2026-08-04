-- 0179a — 유입경로별 통계에 **금액 기재 건수**를 더한다 (2026-08-05).
--
-- 배경(원장 2026-08-05): *"해당 경로로 발생한 금전적인 이득 등"* — 경로별 매출을 보고 싶다.
--
-- 🔴 합계만 보여주면 **경로끼리 비교가 왜곡된다.** `payment_amount` 기재율이 경로마다 다르기 때문이다
--    (실측 2026-08-05, 등록 건 기준):
--      소개·추천  등록 196건 중 금액 기재 146건(74%) → 합계 40,133,130원
--      인터넷     등록  92건 중 금액 기재  47건(51%) → 합계 15,154,875원
--    인터넷이 작은 건 건수가 적어서이기도 하지만 **기재율이 23%p 낮아서** 더 작게 보인다.
--    그래서 화면은 합계와 함께 **건당 평균**을 보여줘야 하고, 그 분모는 '등록 건수'가 아니라
--    **'금액이 기재된 등록 건수'** 여야 한다. 등록 건수로 나누면 건당 금액이 실제보다 낮게 나온다
--    (소개 40,133,130÷196=204,761원 vs 실제 ÷146=274,884원 — 34% 과소).
--
-- ⚠️ 반환 컬럼이 늘어나므로 `create or replace`로는 안 된다(OUT 파라미터 변경 불가) → drop 후 재생성.
--    호출부는 `.rpc()`라 컬럼을 이름으로 읽고, 새 컬럼이 없어도 undefined로 떨어지게 짜여 있어
--    적용 전/후 둘 다에서 화면이 산다(#95 expand/contract).

drop function if exists public.consultation_path_stats(timestamptz, timestamptz);

create function public.consultation_path_stats(
  p_start timestamptz,
  p_end timestamptz
)
returns table (
  path text,            -- null = 미기재
  total bigint,
  enrolled bigint,
  paid_sum numeric,
  paid_cnt bigint       -- 등록 건 중 **결제금액이 적힌** 건수. 건당 평균의 분모.
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    nullif(btrim(consultation_path), '') as path,
    count(*) as total,
    count(*) filter (where outcome = 'enrolled') as enrolled,
    coalesce(sum(payment_amount) filter (where outcome = 'enrolled'), 0) as paid_sum,
    count(*) filter (where outcome = 'enrolled' and payment_amount is not null) as paid_cnt
  from enrollment_consultations
  where tenant_id = auth_tenant_id()
    and consulted_at >= p_start
    and consulted_at < p_end
  group by 1;
$$;

comment on function public.consultation_path_stats(timestamptz, timestamptz) is
  '유입경로별 성과(원문 그대로, null=미기재 포함). paid_cnt = 금액이 적힌 등록 건수 — 건당 평균의 분모.';
