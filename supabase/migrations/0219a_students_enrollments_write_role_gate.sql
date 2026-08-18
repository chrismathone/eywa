-- 0219a — 학생·수강 쓰기 역할 게이트 + 감사로그 append-only (2026-08-18 퇴원 사고 후속, 적대 리뷰 F1)
--
-- 배경: 2026-08-18 소급 퇴원 사고 대응(d3cbe93d)이 서버 액션 게이트(canManageStudentRecords) +
-- 전수 감사로그를 깔았지만, students·enrollments·audit_logs의 RLS는 여전히 **역할을 안 보는
-- tenant_isolation(for all) 하나**뿐이었다(#92 패턴). 그래서 강사 세션 JWT + 공개 anon 키의
-- PostgREST 직결(`PATCH /rest/v1/students?...`)은 서버 게이트·감사로그를 전부 우회해 퇴원 처리가
-- 가능했고, audit_logs는 본인 흔적 행을 DELETE로 지울 수 있었다. 이 파일이 DB 계층에서 닫는다.
--
-- 설계:
--  · students·enrollments: **쓰기(insert/update/delete)만** 역할 제한. SELECT는 종전(테넌트 격리)
--    그대로 — 강사 열람(#77의 '읽기만 해')·시간표·출석부 조회는 불변.
--  · restrictive 정책이라 기존 permissive tenant_isolation과 AND 결합(테넌트 격리 그대로 유효).
--  · 허용 역할 = **사무실 역할 전원**(master·super_admin·admin·manager·counselor·accountant).
--    super_admin은 결정 로그("새로 만드는 어떤 게이트도 자동 통과"). accountant는 students 메뉴가
--    readonly지만 **퇴원관리(withdrawals) full**이라 퇴원 메타 체크·재원 복구가 세션 클라로
--    students/enrollments를 쓴다 — 빼면 화면은 허용인데 DB가 거부(#92의 "화면과 어긋남").
--    차단 = teacher·viewer·student(전부 열람 계열 — 학생 레코드를 쓰는 서버 액션이 하나도 없다).
--  · ⚠️ auth_menu_access를 쓰지 않은 이유: 그 함수의 DEFAULTS jsonb에 students 행이 없다(0158a/0170a
--    — 게다가 0170a는 2026-08-18 현재 프로덕션 미적용 확인). 행이 없는 메뉴는 master 빼고 전부
--    'none'으로 떨어져 사무실 전원이 DB에서 잠긴다(#92 락아웃). 역할 명단이 단순·안전.
--    트레이드오프: 화면의 역할 override/개인 예외로 students full을 **새로** 부여해도 DB 쓰기는 이
--    명단만 통과한다 — 그런 위임을 하게 되면 이 명단도 같은 커밋에서 갱신할 것.
--  · admin(service_role) 클라이언트는 RLS 우회 — 웹훅·makeedu 동기화·관리 스크립트는 영향 없음.
--  · move_enrollments_batch(0027h)는 security **invoker**라 enrollments 정책이 RPC 직접 호출도 막는다.
--  · #91: 게이트 함수는 컬럼과 비교되지 않으므로 (select …)로 감싸 InitPlan 1회 평가.
--
-- audit_logs = append-only:
--  · SELECT 테넌트 격리 유지(감사로그 뷰어·지난 주 담임 복원(teacher-as-of)이 세션 클라로 읽는다).
--  · INSERT는 **본인 명의만**(actor_id = auth.uid()) — 앱의 세션 클라 INSERT는 전부 actor_id=본인
--    (log.ts logAction · board-roster-actions)이라 동작 불변. 시스템 기록(웹훅·스크립트)은 admin 클라(우회).
--  · UPDATE/DELETE 정책 없음 = 전면 거부 — 범인이 자기 흔적을 지우거나 고칠 수 없다.
--
-- 멱등: drop policy if exists → create. 앱 코드와 무관(정책만)이라 배포 순서 제약 없음(#95 안전).
-- 롤백: *_write_role_gate 6개 + audit_logs_select/insert_own drop 후 0031a의 tenant_isolation 재실행.

begin;

-- ── students · enrollments 쓰기 역할 게이트 ─────────────────────────────────
do $$
declare
  t text;
  allowed constant text :=
    $roles$((select public.auth_system_role()) in ('master','super_admin','admin','manager','counselor','accountant'))$roles$;
begin
  foreach t in array array['students', 'enrollments'] loop
    execute format('drop policy if exists %I_insert_role_gate on public.%I', t, t);
    execute format(
      'create policy %I_insert_role_gate on public.%I as restrictive for insert to authenticated with check %s',
      t, t, allowed);
    execute format('drop policy if exists %I_update_role_gate on public.%I', t, t);
    execute format(
      'create policy %I_update_role_gate on public.%I as restrictive for update to authenticated using %s with check %s',
      t, t, allowed, allowed);
    execute format('drop policy if exists %I_delete_role_gate on public.%I', t, t);
    execute format(
      'create policy %I_delete_role_gate on public.%I as restrictive for delete to authenticated using %s',
      t, t, allowed);
  end loop;
end $$;

-- ── audit_logs append-only ──────────────────────────────────────────────────
drop policy if exists audit_logs_tenant_isolation on public.audit_logs;
drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs
  for select to authenticated
  using (tenant_id = public.auth_tenant_id());
drop policy if exists audit_logs_insert_own on public.audit_logs;
create policy audit_logs_insert_own on public.audit_logs
  for insert to authenticated
  with check (tenant_id = public.auth_tenant_id() and actor_id = (select auth.uid()));

commit;
