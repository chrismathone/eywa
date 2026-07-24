-- 보고서 목록(/lesson-reports) **반(class) 필터 옵션** = 최근 N일 lesson_reports에 실제로 붙어 있는 distinct 반.
--
-- 왜 RPC인가: 0126a(강사·과목 옵션)와 **완전히 같은 이유**다 — distinct는 집계이므로 전건 select로 만들면
-- PostgREST max-rows(≈1000)가 명시 limit을 덮어 **에러 없이 잘린다**(B2). 0126a 주석의 실측 사고 참조:
-- 옵션에서 빠진 값은 자유입력 없는 <select> 소비처라 **어떤 경로로도 필터할 수 없게** 된다.
-- 지금은 class_id가 붙은 행이 적어(2026-07 실측 1,520건 중 71건) 잘릴 일이 없지만, 발송이 eywa로
-- 넘어올수록 모든 신규 보고서에 class_id가 붙어 몇 달이면 1000행을 넘는다 → 그때 조용히 반이 사라진다.
-- "지금은 작으니 괜찮다"가 정확히 0126a가 당한 함정이라 처음부터 RPC로 간다.
--
-- ⚠️ 0126a를 **확장하지 않고 새 함수로 분리한 이유** 두 가지:
--   ① Postgres는 기존 함수의 반환 타입을 `create or replace`로 못 바꾼다(DROP 후 재생성 필요) →
--      배포 중 함수가 잠깐 사라지는 창이 생기고, 구 코드/신 코드 순서 제약이 붙는다.
--   ② 같은 distinct에 반을 섞으면 결과가 (강사 × 과목 × 반) 조합으로 불어난다 — 0126a가 "쌍 개수는
--      강사수×과목수 상한이라 작다"고 못 박은 전제가 깨진다.
--   분리하면 기존 RPC·호출부는 무변경이고, 호출부는 두 RPC를 Promise.all로 병렬 조회한다(B4).
--
-- ⚠️ 반이 없는 보고서(edutrix 이관분 대다수)는 애초에 옵션 대상이 아니다 — class_id is not null + inner join.
--   이관분은 subject가 전부 NULL이라 반 추정(resolveReportClassId)이 구조적으로 불가하다(0134a 참조).
--
-- security invoker(호출자 RLS) + 명시적 auth_tenant_id() 필터로 멀티테넌트 격리 이중 방어(0039a·0126a 패턴).
-- classes 조인도 tenant를 다시 건다 — RLS가 이미 막지만, 정책 하나가 빠져도 새지 않게(이중 방어 원칙).
--
-- 롤백:
--   drop function if exists public.lesson_report_class_options(date);
create or replace function public.lesson_report_class_options(p_since date)
returns table (class_id uuid, class_name text)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct r.class_id, c.class_name
  from lesson_reports r
  join classes c
    on c.id = r.class_id
   and c.tenant_id = auth_tenant_id()
  where r.tenant_id = auth_tenant_id()
    and r.report_date >= p_since
    and r.class_id is not null
  order by c.class_name;
$$;

-- PostgREST가 새 함수를 인식하도록 스키마 캐시 갱신(0134a와 같은 규약 — 빼먹으면 PGRST202로 계속 실패).
-- ⚠️ 화면 정렬은 여기 order by에 의존하지 않는다 — 호출부(getReportFilterOptions)가 localeCompare("ko")로
--    다시 세운다(DB 콜레이션은 로마자를 한글보다 앞에 둬 화면 다른 목록과 어긋난다, gotcha #84).
notify pgrst, 'reload schema';
