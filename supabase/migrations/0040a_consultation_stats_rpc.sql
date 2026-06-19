-- 상담 통계 집계 RPC — 전건 fetch + JS 집계(PostgREST ~1000행 silent truncation, #54)를 DB group-by 1쿼리로 대체.
-- /consultations/stats 의 카테고리 분포·월별 추세 차트. 현재 데모에 student_consultations 1340행이 있어
-- 6개월 윈도우가 1000행에서 잘려 카테고리·추세가 실제보다 과소집계되고 있었다(이 RPC로 해소).
-- security invoker(호출자 RLS 적용) + 명시적 auth_tenant_id() 필터로 멀티테넌트 격리 이중 방어(0039a 패턴).

-- ① 카테고리 분포 — sinceIso 이후 학생상담을 category별 count (구 getConsultationByCategory: 전건 fetch + JS Map).
create or replace function public.consultation_category_counts(p_since timestamptz)
returns table (category text, count bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(category, 'other') as category, count(*) as count
  from student_consultations
  where tenant_id = auth_tenant_id()
    and consulted_at >= p_since
  group by coalesce(category, 'other');
$$;

-- ② 월별 추세 — start 이후 등록상담·학생상담을 'YYYY-MM' 월버킷별 count (구 getConsultationTrend: 양 테이블 전건 fetch + JS).
-- 데이터 없는 달은 호출부 JS가 0으로 채움(여기선 존재하는 달만 반환).
create or replace function public.consultation_monthly_trend(p_start timestamptz)
returns table (month text, enrollment bigint, student bigint)
language sql
stable
security invoker
set search_path = public
as $$
  with ec as (
    select to_char(date_trunc('month', consulted_at), 'YYYY-MM') as m, count(*) as c
    from enrollment_consultations
    where tenant_id = auth_tenant_id()
      and consulted_at >= p_start
    group by 1
  ),
  sc as (
    select to_char(date_trunc('month', consulted_at), 'YYYY-MM') as m, count(*) as c
    from student_consultations
    where tenant_id = auth_tenant_id()
      and consulted_at >= p_start
    group by 1
  )
  select
    coalesce(ec.m, sc.m) as month,
    coalesce(ec.c, 0) as enrollment,
    coalesce(sc.c, 0) as student
  from ec
  full outer join sc on ec.m = sc.m;
$$;
