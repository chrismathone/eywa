-- 0166a — 정책에 남아 있던 **컬럼 없는 함수 필터**를 InitPlan으로 (gotchas #91의 잔여분 정리).
--
-- 0164a가 invoices·expenses를 고친 뒤 "같은 모양이 더 있나"를 프로덕션 카탈로그로 전수 조사한 결과:
--
-- ✅ **`tenant_id = auth_tenant_id()`(정책 86개·75테이블)는 고칠 필요가 없다 — 이미 최적이다.**
--    적대 검증은 "전건 select에 남은 155ms가 이 항"이라 지목했지만 **오진이었다.** 이 항은 컬럼과의
--    **동등비교**라 플래너가 함수를 **인덱스 스캔 키**로 쓴다(1회 평가):
--        Index Only Scan using lesson_reports_tenant_idx
--          Index Cond: (tenant_id = auth_tenant_id())        ← Filter가 아니다
--    실측(롤백 트랜잭션에서 감싸 보고 비교): lesson_reports 18ms→15ms · activity_log 257→268 ·
--    attendance_records 12→12 · invoices 13→13 = **차이 없음**. 86개 정책을 건드릴 이유가 없다.
--    📌 판별 기준은 "함수를 썼나"가 아니라 **"컬럼과 비교되나"** — 비교되면 스캔 키, 아니면 행마다 Filter.
--
-- 🔴 진짜 잔여분 = **컬럼과 비교되지 않는 함수 항**. 전수 6개 중 5개가 해당(1개는 아래 예외).
--    가장 큰 건 activity_log(18,334행):
--        Index Cond: (tenant_id = auth_tenant_id())
--        Filter: (auth_system_role() = ANY ('{master,admin,manager}'))   ← 행마다 호출
--    실측: activity_log count **262ms → 18ms**(EXPLAIN 실행시간 268ms → 6.5ms).
--    나머지(staff_contracts 132행·academy_documents 60행·class_salary_settings 14행·login_events 0행)는
--    지금은 작아 체감이 없지만 **같은 규칙으로 통일**한다 — 행이 늘면 조용히 느려지는 자리다.
--
-- ⚠️ **예외로 남긴 것 1개**: `consultation_ai_analysis.ai_tenant_isolation`의
--    `exists (select 1 from enrollment_consultations ec where ec.id = consultation_ai_analysis.consultation_id …)`는
--    **바깥 행의 컬럼을 참조하는 상관 서브쿼리**라 행마다 평가돼야 맞다. 감싸면 의미가 바뀐다(감싸지 말 것).
--
-- ⚠️ 각 원본 파일(0081a·0082a·0130a·0148a·0149a)에도 같은 형태를 접어 넣었다 — 이 파일은 alter로
--    덧칠만 하므로, 원본만 단독 재적용하면 느린 형태가 **에러 0건으로** 되살아난다(0158a에서 겪은 함정).
--
-- 멱등: alter policy(권한 의미 불변 — 같은 불리언을 N번 계산하던 걸 1번 계산할 뿐). 롤백: `(select …)`만 제거.

-- activity_log — 18,334행. 이번 변경의 실질 이득 전부가 여기 있다.
alter policy activity_log_office_read on public.activity_log
  using (
    tenant_id = public.auth_tenant_id()
    and (select public.auth_system_role()) in ('master', 'admin', 'manager')
  );

alter policy staff_contracts_office_write on public.staff_contracts
  using (
    tenant_id = public.auth_tenant_id()
    and (select public.auth_system_role()) in ('master', 'admin', 'manager')
  )
  with check (
    tenant_id = public.auth_tenant_id()
    and (select public.auth_system_role()) in ('master', 'admin', 'manager')
  );

-- academy_documents — `restricted is not true`·`staff_user_id = auth.uid()`는 **컬럼 항이라 그대로 둔다**.
-- 가운데 역할 항만 감싼다(이력서 restricted 가드, 0148a).
alter policy academy_documents_restricted_guard on public.academy_documents
  using (
    restricted is not true
    or (select public.auth_system_role()) in ('master', 'admin', 'manager', 'accountant')
    or staff_user_id = (select auth.uid())
  );

-- class_salary_settings — exists가 바깥 컬럼을 참조하지 않는(비상관) 서브쿼리라 통째로 감쌀 수 있다.
alter policy class_salary_settings_master_all on public.class_salary_settings
  using (
    tenant_id = public.auth_tenant_id()
    and (select exists (
      select 1 from public.users u
      where u.id = (select auth.uid()) and u.system_role = 'master' and u.tenant_id = public.auth_tenant_id()
    ))
  )
  with check (
    tenant_id = public.auth_tenant_id()
    and (select exists (
      select 1 from public.users u
      where u.id = (select auth.uid()) and u.system_role = 'master' and u.tenant_id = public.auth_tenant_id()
    ))
  );

alter policy login_events_office_read on public.login_events
  using (
    tenant_id = public.auth_tenant_id()
    and (select public.auth_system_role()) in ('master', 'admin', 'manager')
  );
