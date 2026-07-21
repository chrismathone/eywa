-- 보고서 목록(/lesson-reports) 강사·과목 필터 옵션 = 최근 N일 lesson_reports의 distinct 값.
--
-- 왜 RPC인가(B2 위반 수리, 2026-07-21): 기존 구현은 `.select("teacher_name, subject").limit(5000)`으로
-- 전건을 받아 JS Set으로 distinct를 만들었는데, PostgREST max-rows(≈1000)가 명시 limit을 덮어
-- **에러 없이 1000행에서 잘렸다.** 실측: 최근 60일 4,010행 중 1,000행만 도달(75% 탈락) → distinct 강사
-- 14명 중 11명만 옵션에 남고 3명이 통째로 사라졌다. 소비처가 자유입력 없는 <select>라, 옵션에서 빠진
-- 강사의 보고서는 **어떤 경로로도 필터할 수 없었다**(보고서가 쌓일수록 누락 강사 증가).
-- distinct는 집계이므로 규칙대로 group-by RPC로 내린다 — 4,010행 스캔 → 17행 반환.
--
-- security invoker(호출자 RLS) + 명시적 auth_tenant_id() 필터로 멀티테넌트 격리 이중 방어(0039a 패턴).
-- 반환은 (강사, 과목) 쌍이고 호출부가 두 집합으로 분리한다 — 쌍 개수는 강사수×과목수 상한이라 작다.
create or replace function public.lesson_report_filter_options(p_since date)
returns table (teacher_name text, subject text)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct r.teacher_name, r.subject
  from lesson_reports r
  where r.tenant_id = auth_tenant_id()
    and r.report_date >= p_since
    and (r.teacher_name is not null or r.subject is not null);
$$;
