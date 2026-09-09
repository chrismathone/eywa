-- 0253a_audit_logs_master_only_select.sql (손수 alpha)
-- 감사로그 **읽기**를 원장(master)·총괄(super_admin)로 좁힌다.
--
-- 배경(원장 2026-09-09): *"감사로그는 마스터 이상급으러만."*
--   0219a가 audit_logs를 append-only로 만들면서 SELECT는 **테넌트 격리만** 남겼다. 그래서 화면은
--   `/owner`(원장·데스크)로 막혀 있어도 **로그인한 강사·뷰어가 PostgREST로 전 로그를 읽을 수 있었다** —
--   화면에서만 잠근 전형적인 구멍이다. 마침 2026-09-09에 감사로그 커버리지를 전수로 넓히면서
--   지출·환불·급여명세서·청구 회차가 로그에 들어오기 시작해, 그 구멍이 곧 `invoices`·`expenses`
--   RLS(0158a)와 급여명세서 명단 게이트를 **우회하는 뒷문**이 된다.
--
-- 🔴 **INSERT는 좁히지 않는다.** 로그는 누구나 자기 행동을 남겨야 한다 — 강사가 출결을 저장할 때
--    `logAction`이 막히면 기록이 통째로 사라져서, 이 마이그레이션이 감사로그를 없애는 꼴이 된다.
--    (0219a의 `audit_logs_insert_own`: 본인 actor_id + 자기 테넌트만. 그대로 둔다.)
--
-- ⚠️ **앱을 먼저 배포하고 이걸 적용할 것**([[#95]] expand/contract). 강사도 쓰는 화면 셋이 감사로그를
--    세션 계정으로 읽고 있었다 — ① 지난 주 담임 복원(teacher-as-of) ② 반 이력 ③ 병합된 상담 따라가기.
--    셋 다 `features/audit/server/system-read.ts`의 **좁은 문**(admin + tenant 명시 + action 허용 목록)
--    으로 옮겼다. 그 배포가 프로덕션에 올라간 **뒤에** 이 SQL을 실행해야 세 화면이 안 죽는다.
--    (반대로 이걸 먼저 적용하면 강사 화면에서 그 셋이 조용히 빈다 — 에러가 아니라 0행이라 더 나쁘다.)
--
-- 멱등: drop policy if exists → create.
-- 롤백: 아래 정책을 drop하고 0219a의 `audit_logs_select`(테넌트 격리)를 다시 만든다.
--   drop policy if exists audit_logs_select_master on public.audit_logs;
--   create policy audit_logs_select on public.audit_logs
--     for select to authenticated using (tenant_id = public.auth_tenant_id());

drop policy if exists audit_logs_select on public.audit_logs;
drop policy if exists audit_logs_select_master on public.audit_logs;

create policy audit_logs_select_master on public.audit_logs
  for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    -- 🔴 `(select ...)`로 감싼다 — 컬럼과 비교되지 않는 게이트 함수를 맨몸으로 쓰면 **행마다** 호출돼
    --    수만 행 스캔이 초 단위로 느려진다([[#91]]). InitPlan으로 접히면 쿼리당 1회다.
    and (select public.auth_system_role()) in ('master', 'super_admin')
  );

-- 확인용(적용 뒤 원장 계정으로 한 번 열어 볼 것):
--   select count(*) from public.audit_logs;          -- 원장: 숫자, 강사: 0
--   /owner?tab=audit 이 그대로 뜨는지, 반 상세 '이력'과 시간표 지난 주 담임이 그대로인지.
