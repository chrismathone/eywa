-- 0178a — 등록상담 통계뷰(칸반/목록/통계 3뷰의 셋째) 집계 RPC 2종 (2026-08-05).
--
-- 배경(원장 2026-08-04): *"칸반/목록/통계 3가지 뷰로 하고 싶으니 통계뷰에 대한 구현 계획 세워볼것.
-- 통계뷰에서 여러가지 CRM을 할거임."* + *"등록상담 경로가 있는 건에 대해 어떤 경로로 유입되었는지,
-- 유입경로별 등록율이 어떠한지 등 다양한 방면에서 정보를 받고 싶음."*
--
-- 🔴 통계뷰에는 칸반·목록의 "최대 1년" 상한을 걸지 않는다. 그 상한은 **행을 가져오기** 때문에 있는 것이고
--    (전건 = 카드 2,197장·payload 1.1MB), 통계는 여기서 집계만 받아 **행을 0개** 가져온다. 원장 목적이
--    "올해와 작년 비교"라 상한을 걸면 목적 자체가 무너진다. 실측상 1~8월은 4년치, 9~12월은 3년치가 있다.
--
-- 🔴 전건 fetch + JS 집계 금지(B2·#54). 2,197행이라 무페이징 select는 1000행에서 조용히 잘린다.
--    0039a/0040a와 같은 패턴: security invoker(호출자 RLS) + 명시적 auth_tenant_id() 필터 = 이중 격리.
--
-- ⚠️ 배포 순서 = **이 마이그레이션이 앱보다 먼저**(2026-08-03 강사 원스크린 먹통 재발 방지). 통계뷰
--    코드는 이 함수를 호출하므로, 적용 전에 앱만 나가면 통계 탭이 죽는다.

-- ① 월별 상담 성과 — 통계뷰의 뼈대(월별 추이 · 전년 동월 비교 · 전환율).
-- 월 버킷은 **KST 기준**으로 자른다. UTC로 자르면 매월 1일 오전 9시 이전 상담이 전달로 밀린다.
create or replace function public.consultation_monthly_stats(
  p_start timestamptz,
  p_end timestamptz
)
returns table (
  month text,
  total bigint,
  enrolled bigint,
  declined bigint,
  no_show bigint,
  open_cnt bigint,      -- 아직 안 끝난 건(pending/scheduled/consulted/ai_done)
  paid_sum numeric      -- 그 달 등록분 결제금액 합(없으면 0)
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    to_char(date_trunc('month', consulted_at at time zone 'Asia/Seoul'), 'YYYY-MM') as month,
    count(*) as total,
    count(*) filter (where outcome = 'enrolled') as enrolled,
    count(*) filter (where outcome = 'declined') as declined,
    count(*) filter (where outcome = 'no_show') as no_show,
    count(*) filter (where outcome in ('pending', 'scheduled', 'consulted', 'ai_done')) as open_cnt,
    coalesce(sum(payment_amount) filter (where outcome = 'enrolled'), 0) as paid_sum
  from enrollment_consultations
  where tenant_id = auth_tenant_id()
    and consulted_at >= p_start
    and consulted_at < p_end
  group by 1;
$$;

-- ② 유입경로별 성과 — **원문 그대로** 돌려준다. 버킷 묶기는 앱의 순수 함수가 한다.
-- 🔴 DB에서 버킷을 굳히지 않는 이유: 경로는 자유 텍스트라 실측 210종이고(681건 중 1건짜리가 160종),
--    묶는 규칙이 계속 바뀐다. 규칙을 SQL에 박으면 바꿀 때마다 마이그레이션이 필요하고 과거 집계와
--    비교가 끊긴다. 원문을 주고 앱에서 묶으면 규칙에 Vitest를 걸 수 있고 "미분류"도 셀 수 있다.
-- ⚠️ null(미기재)도 한 행으로 돌려준다 — 실측 미기재가 69%라, 빼고 세면 "설명회 73건"이 전체 대비인지
--    기재분 대비인지 화면이 구분할 수 없게 된다. 미상은 지표에서 가장 정직해야 할 숫자다.
create or replace function public.consultation_path_stats(
  p_start timestamptz,
  p_end timestamptz
)
returns table (
  path text,            -- null = 미기재
  total bigint,
  enrolled bigint,
  paid_sum numeric
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
    coalesce(sum(payment_amount) filter (where outcome = 'enrolled'), 0) as paid_sum
  from enrollment_consultations
  where tenant_id = auth_tenant_id()
    and consulted_at >= p_start
    and consulted_at < p_end
  group by 1;
$$;

comment on function public.consultation_monthly_stats(timestamptz, timestamptz) is
  '등록상담 월별 성과(KST 월 버킷). 통계뷰 전용 — 행을 반환하지 않으므로 기간 상한이 없다.';
comment on function public.consultation_path_stats(timestamptz, timestamptz) is
  '유입경로별 성과. 경로는 원문 그대로(버킷 묶기는 앱 순수 함수). null = 미기재도 한 행으로 반환.';
