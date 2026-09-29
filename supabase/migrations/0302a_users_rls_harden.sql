-- 0302a — users 표 RLS 강화: 전 직원이 서로의 계정을 고치고·지우고·만들던 구멍을 닫는다 (보안 감사 2026-09-29, 초안).
--
-- ── 왜 ───────────────────────────────────────────────────────────────────────────────────────────────
-- users의 정책은 0001a의 `users_tenant_isolation` 하나뿐이었다:
--     for all to authenticated using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id())
-- 역할을 전혀 안 본다. 0026a 가드 트리거는 UPDATE에서 system_role·tenant_id 변경만 막는다.
-- 그래서 같은 학원의 **강사·학생 누구든** 공개 anon 키 + 자기 세션으로 PostgREST(/rest/v1/users)에 직접 붙으면:
--   · UPDATE — 남의 display_name을 바꿔 사칭, 자기 `teacher_view_access=true`(남의 강사 화면 열람 권한),
--              남의 status='inactive'(원장 퇴사 처리), 남의 email 교체(로그인 계정과 어긋나게), 급여 컬럼 조작
--   · DELETE — 원장 행을 지워 학원 셸 진입 불가
--   · INSERT — 새 auth uid로 system_role='master' 행 생성(0026a 트리거는 UPDATE 전용이라 못 막는다)
--   · SELECT — 전 직원 hourly_rate·monthly_base·commission_rate(s)·salary_type(급여) 열람  ← ⚠️ 이 파일은 못 닫는다(아래)
-- 앱 게이트(canWriteTenant("staff") 등)는 화면·서버 액션만 잠근다 = gotchas #77 "화면에서만 잠갔다"·#92.
--
-- ── 이 파일이 하는 일 ──────────────────────────────────────────────────────────────────────────────────
--   ① `users_tenant_isolation`(for all) 삭제 → SELECT(같은 학원) / UPDATE(본인 행 또는 직원관리 쓰기 권한자) 로 분리.
--      INSERT·DELETE 정책은 **두지 않는다** = authenticated 거부, service_role(admin 클라이언트) 전용.
--      (앱의 users INSERT·DELETE는 전부 admin 클라이언트다 — 2026-09-29 전수 확인: 직원 생성·삭제·이력서·공개 입사서류.)
--   ② 가드 트리거 `guard_user_privilege_columns`(0026a) 확장 — 바뀐 컬럼을 계산해 역할별로 허용 목록을 건다:
--      · 누구든 불가: id · system_role · tenant_id (0026a 유지)
--      · 직원관리 쓰기 권한자(원장·개인 예외·super_admin 등 `auth_users_can_manage()`):
--          급여 5컬럼은 **원장만** · teacher_view_access는 **원장·super_admin만** · 본인 status 변경 불가 ·
--          남의 email·status는 **자기 이하 직급만**(앱 canManageStaffMember와 같은 위계, super_admin은 통과) ·
--          총괄(super_admin) 계정의 email·status는 **총괄만**(앱 isProtectedSuperAdminTarget 미러) ·
--          본인 email은 세션 직결 불가('내 정보' = admin 경로만 — auth.users와 어긋나지 않게)
--      · 학원설정 쓰기 권한자의 과목 흡수(0077a `absorb_subject_key` = security invoker): `subjects`만(본인 행 포함).
--      · 그 외(강사·학생·참관 등) **본인 행**: 화면 설정 5컬럼만(ui_prefs·teacher_view_lang·report_notice_mode·
--          report_display_name·textbook_notice_ment). 앱은 지금 이 5개도 admin 클라이언트로 쓰지만 막을 이유가 없어 연다.
--
-- ── 이 파일이 **안** 닫는 것 (의도적 제외 — #92 규칙대로 이름으로 적는다) ─────────────────────────────────
--   · **급여 컬럼 SELECT** (hourly_rate·monthly_base·salary_type·commission_rate·commission_rates):
--     RLS는 행 단위라 컬럼을 못 가린다. 컬럼 권한(REVOKE)은 **원장에게도** 똑같이 걸리는데(권한은 roles 단위 =
--     authenticated 전체), 앱이 지금 세션 클라이언트로 이 컬럼을 읽는 곳이 6군데(직원 상세·급여·정산·명세서·
--     출석부 강사 금액) + `select("*", {head:true})` 카운트 2군데가 있어 **지금 REVOKE하면 그 화면이 즉시 죽는다**
--     (#95). → 앱이 그 읽기를 "앱 게이트 통과 후 admin 클라이언트"로 옮겨 배포한 **뒤** 별도 파일(0302b)로 잠근다.
--   · 같은 학원 직원 전원이 서로의 email·phone·memo·work_schedule·notion_user_id·ui_prefs를 읽는 것 —
--     강사 드롭다운·회의 화자 연결·시간표 등 전 앱이 users를 읽어서 행 단위로는 좁힐 수 없다(0170a 주석과 같은 판단).
--   · 직원관리 쓰기 권한자가 PostgREST 직결로 남의 **비권한** 칸(이름·색·메모 등)을 고치는 것 — 원래 그 사람의 권한이다.
--     (단 앱의 과목 범위 제한 `canSeeStaffMember`는 DB로 내리지 않았다 = 과목 밖 직원도 직결로는 고칠 수 있다.)
--
-- ── 적용 순서 (#95 expand/contract) ────────────────────────────────────────────────────────────────────
--   **앱 배포와 독립 — 지금 앱 그대로 먼저 적용해도 된다.** 근거(2026-09-29 전수 조사, `.from("users")` 265곳):
--   세션 클라이언트로 users를 **쓰는** 곳은 전부 직원관리 쓰기 권한자 경로다 —
--     staff/server/actions.ts updateStaff(근무 설정)·deactivateStaff·handoverAndDeactivate(status),
--     payroll/server/comp-actions.ts(원장만 세션, 급여 컬럼), owner 과목 흡수 RPC(absorb_subject_key).
--   세션으로 INSERT·DELETE하는 곳은 0곳. 세션 SELECT는 같은 학원 행만 읽으므로 그대로 동작한다.
--   ⚠️ 전제: 0170a(auth_menu_access의 개인 예외 userOverrides)가 **적용돼 있어야** 한다. 안 돼 있으면 개인 예외로
--      직원관리를 받은 관리자(설현·이승엽)가 DB에서 쓰기 권한자로 안 잡혀 **근무 설정 저장이 에러 없이 0행**이 된다
--      (updateStaff는 반영 행 수를 안 본다 = "저장됨" 거짓 약속). 아래 사전 점검 블록이 0170a 미적용이면 중단한다.
--   ⚠️ users는 모든 요청이 읽는 표라 DROP/CREATE POLICY의 배타잠금이 줄을 세울 수 있다 → lock_timeout 5초.
--      잠금을 못 잡으면 에러로 끝나니(부분 적용 없음 — 한 트랜잭션) 한산한 시간에 다시 실행한다.
--
-- ⚠️ 게이트 함수는 정책에서 `(select f())`로 감싼다(#91 InitPlan). `tenant_id = auth_tenant_id()`는 컬럼 비교라
--    Index Cond(1회)로 도므로 감싸지 않는다(0001a 원형 유지). 새 함수는 전부 security definer + search_path 고정 +
--    public/anon 실행권 회수. 정책이 다른 표를 조회하지 않으므로 교차 재귀(#109, 42P17) 없음.
-- ⚠️ 위계(원장0 < 관리자1 < 매니저2 < 회계3 < 상담4 < 강사5 < 참관6 < 학생7)는 src/lib/auth/role-hierarchy.ts
--    ROLE_HIERARCHY의 **미러**다. 역할을 추가·재배열하면 이 트리거도 같은 커밋에서 고칠 것.
-- ⚠️ 본인 허용 5컬럼·급여 5컬럼 목록도 코드와 같이 움직인다 — users에 새 "화면 설정" 칸을 세션 클라이언트로 쓰게
--    되면 c_self_allowed에, 새 급여성 칸을 만들면 c_salary(+0120a 활동로그 redact)에 더할 것.
--
-- 멱등: create or replace function + drop policy/trigger if exists → create.
-- 되돌리기는 별도 요청(이 파일에 되돌리기 SQL을 두지 않는다).

-- 명시 트랜잭션(0297a·0298a와 같은 모양) — 어느 문장이 실패해도(잠금 대기 초과 포함) 통째로 되돌아간다.
-- ⚠️ 실패하면 SQL Editor에 에러가 뜨고 **아무것도 바뀌지 않은 상태**다. 그대로 다시 실행하면 된다.
begin;

set local statement_timeout = '60s';
set local lock_timeout = '5s';

-- ── 0. 사전 점검 — 전제가 빠졌으면 아무것도 바꾸지 않고 중단 ─────────────────────────────────────────────
do $$
begin
  -- 미러 트리거(0075a)·auth_tenant_id() 등 security definer 함수는 "표 소유자는 RLS를 안 탄다"에 기대어
  -- INSERT·DELETE 정책 없이도 users를 쓴다. FORCE RLS가 걸려 있으면 그 전제가 깨져 신규 계정 생성이 막힌다.
  if (select c.relforcerowsecurity from pg_class c where c.oid = 'public.users'::regclass) then
    raise exception '0302a 중단: public.users에 FORCE ROW LEVEL SECURITY가 걸려 있습니다 — 미러 트리거가 막힐 수 있어 적용하지 않습니다';
  end if;
  if to_regprocedure('public.auth_menu_access(text)') is null then
    raise exception '0302a 중단: auth_menu_access(text)가 없습니다 — 0158a·0170a를 먼저 적용하세요';
  end if;
  if pg_get_functiondef('public.auth_menu_access(text)'::regprocedure) not like '%userOverrides%' then
    raise exception '0302a 중단: auth_menu_access가 개인 예외(userOverrides)를 모릅니다 — 0170a를 먼저 적용하세요';
  end if;
  if to_regprocedure('public.is_super_admin(uuid)') is null then
    raise exception '0302a 중단: is_super_admin(uuid)가 없습니다 — 0021a를 먼저 적용하세요';
  end if;
  if to_regprocedure('public.auth_system_role()') is null then
    raise exception '0302a 중단: auth_system_role()이 없습니다 — 0072a를 먼저 적용하세요';
  end if;
end $$;

-- ── 1. 게이트 함수 ─────────────────────────────────────────────────────────────────────────────────────
-- 직원관리 쓰기 권한자 = 앱 canWriteTenant(role, "staff")의 DB 미러(개인 예외·역할 override·코드 기본값, master 상시 full)
--   + super_admin(앱 perm-matrix가 mergeMostPermissive로 올려 주는 것과 같은 취지 — "새 게이트는 super_admin 자동 통과").
-- ⚠️ '다른 강사 뷰'(열람 전용) 캡은 앱 전용 상태라 DB가 모른다 — 그 캡은 앱 게이트가 계속 맡는다.
create or replace function public.auth_users_can_manage() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce(public.auth_menu_access('staff'), 'none') in ('full', 'scoped')
      or coalesce(public.is_super_admin(auth.uid()), false)
$$;
revoke all on function public.auth_users_can_manage() from public, anon;
grant execute on function public.auth_users_can_manage() to authenticated, service_role;

-- 학원설정 쓰기 권한자 — 과목 흡수 RPC(absorb_subject_key)가 남의 users.subjects를 바꾸는 경로 전용.
-- (앱 게이트 = subject-actions.ts requireOwnerWrite → canWriteTenant(role, "owner"). 원장은 위 함수로 이미 통과.)
create or replace function public.auth_users_can_absorb_subjects() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce(public.auth_menu_access('owner'), 'none') in ('full', 'scoped')
$$;
revoke all on function public.auth_users_can_absorb_subjects() from public, anon;
grant execute on function public.auth_users_can_absorb_subjects() to authenticated, service_role;

-- ── 2. 정책 — for all 하나를 SELECT / UPDATE로 분리, INSERT·DELETE는 정책 없음(= authenticated 거부) ─────────
alter table public.users enable row level security;

drop policy if exists users_tenant_isolation on public.users;

drop policy if exists users_select_same_tenant on public.users;
create policy users_select_same_tenant on public.users
  for select to authenticated
  using (tenant_id = public.auth_tenant_id());

-- 행 범위만 여기서 정한다(본인 / 직원관리 쓰기 권한자 / 과목 흡수). **어떤 칸을** 바꿀 수 있는지는 3번 트리거가 본다.
drop policy if exists users_update_self_or_manager on public.users;
create policy users_update_self_or_manager on public.users
  for update to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and (
      id = (select auth.uid())
      or (select public.auth_users_can_manage())
      or (select public.auth_users_can_absorb_subjects())
    )
  )
  with check (tenant_id = public.auth_tenant_id());

-- ── 3. 가드 트리거 확장 (0026a 함수 교체 — 트리거 이름·시점 동일) ──────────────────────────────────────────
-- BEFORE UPDATE 트리거는 이름순으로 돈다: tg_guard_user_privilege_columns → users_set_updated_at.
-- 그래서 여기서는 updated_at을 비교 대상에서 뺀다(클라이언트가 직접 보내도 무해).
create or replace function public.guard_user_privilege_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_old jsonb;
  v_changed text[];
  v_bad text[];
  v_actor_role text;
  v_is_master boolean;
  v_is_super boolean;
  v_actor_rank int;
  v_target_rank int;
  -- 본인이 직접 바꿔도 되는 "화면 설정" 칸(권한·신원·급여와 무관)
  c_self_allowed constant text[] := array[
    'ui_prefs', 'teacher_view_lang', 'report_notice_mode', 'report_display_name', 'textbook_notice_ment'
  ];
  -- 급여성 칸(0119a·0130a, 활동로그 redact 대상과 같은 목록) — 원장만
  c_salary constant text[] := array[
    'hourly_rate', 'monthly_base', 'salary_type', 'commission_rate', 'commission_rates'
  ];
  -- 계정 탈취·퇴사 처리로 이어지는 칸 — 남의 행이면 자기 이하 직급만(앱 canManageStaffMember 미러)
  c_hierarchy constant text[] := array['email', 'status'];
begin
  -- service_role(admin 클라이언트)·SQL 편집기·auth 미러 트리거(GoTrue)는 사용자 JWT가 없다 → 통과(0026a와 같음).
  if v_uid is null then
    return new;
  end if;

  if new.id is distinct from old.id then
    raise exception 'id는 바꿀 수 없습니다' using errcode = '42501';
  end if;
  if new.system_role is distinct from old.system_role then
    raise exception 'system_role은 직접 변경할 수 없습니다 (관리자 도구를 사용하세요)' using errcode = '42501';
  end if;
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'tenant_id는 직접 변경할 수 없습니다' using errcode = '42501';
  end if;

  -- 실제로 값이 바뀐 칸만 모은다(같은 값을 다시 실은 칸은 무시 — 근무 설정 폼은 안 바뀐 칸도 전부 싣는다).
  v_old := to_jsonb(old);
  select coalesce(array_agg(n.key order by n.key), '{}'::text[])
    into v_changed
  from jsonb_each(to_jsonb(new)) as n(key, value)
  where n.value is distinct from (v_old -> n.key)
    and n.key <> 'updated_at';

  if cardinality(v_changed) = 0 then
    return new;
  end if;

  v_actor_role := coalesce(public.auth_system_role(), '');
  v_is_master := v_actor_role = 'master';
  v_is_super := coalesce(public.is_super_admin(v_uid), false);

  -- ① 직원관리 쓰기 권한자
  if v_is_master or v_is_super or public.auth_users_can_manage() then
    if v_changed && c_salary and not v_is_master then
      raise exception '급여 항목은 원장만 바꿀 수 있습니다' using errcode = '42501';
    end if;
    if 'teacher_view_access' = any (v_changed) and not (v_is_master or v_is_super) then
      raise exception '''강사뷰 접근''은 원장만 바꿀 수 있습니다' using errcode = '42501';
    end if;
    if new.id = v_uid and 'status' = any (v_changed) then
      raise exception '본인 계정의 재직 상태는 바꿀 수 없습니다' using errcode = '42501';
    end if;
    -- 본인 로그인 이메일은 '내 정보'(me-actions, admin 클라이언트 + auth.users 동시 변경)로만 — 세션 직결로
    -- public.users만 바꾸면 auth.users와 어긋난다(미러가 다음 auth 갱신 때 되덮을 때까지). 앱 경로는 영향 없음:
    -- auth 계정이 있는 행은 admin이 auth를 먼저 바꾸고 미러가 public을 맞춘 뒤라 세션 UPDATE에선 "안 바뀐 칸"이다.
    if new.id = v_uid and 'email' = any (v_changed) then
      raise exception '본인 로그인 이메일은 ''내 정보''에서 바꾸세요' using errcode = '42501';
    end if;
    -- 총괄(super_admin) 계정의 이메일·재직 상태는 총괄만 — 앱 isProtectedSuperAdminTarget의 DB 미러
    -- (같은 지점 원장이라도 총괄을 퇴사·이메일 교체로 쫓아낼 수 없다 — 보안 감사 2026-09-29).
    if new.id <> v_uid and v_changed && c_hierarchy and not v_is_super
       and coalesce(public.is_super_admin(new.id), false) then
      raise exception '총괄 관리자 계정은 총괄 관리자만 변경할 수 있습니다' using errcode = '42501';
    end if;
    if new.id <> v_uid and v_changed && c_hierarchy and not v_is_super then
      v_actor_rank := case v_actor_role
        when 'master' then 0 when 'admin' then 1 when 'manager' then 2 when 'accountant' then 3
        when 'counselor' then 4 when 'teacher' then 5 when 'viewer' then 6 when 'student' then 7
        else 99 end;
      v_target_rank := case old.system_role::text
        when 'master' then 0 when 'admin' then 1 when 'manager' then 2 when 'accountant' then 3
        when 'counselor' then 4 when 'teacher' then 5 when 'viewer' then 6 when 'student' then 7
        else 99 end;
      if v_actor_rank > v_target_rank then
        raise exception '본인보다 상위 권한 직원의 로그인 이메일·재직 상태는 바꿀 수 없습니다' using errcode = '42501';
      end if;
    end if;
    return new;
  end if;

  -- ② 학원설정 쓰기 권한자의 과목 흡수 — subjects만(본인 행 포함).
  --    ⚠️ 본인 행 분기(③)보다 **먼저** 본다: 흡수 RPC는 한 문장으로 테넌트 전 행을 고치므로, 실행자 본인의
  --    subjects에 옛 키가 있으면 본인 행 분기가 'subjects'를 거절해 **흡수 전체가 실패**한다
  --    (직원관리 권한 없이 학원설정만 위임받은 관리자가 담당 과목을 가진 겸직일 때).
  if v_changed <@ array['subjects']::text[] and public.auth_users_can_absorb_subjects() then
    return new;
  end if;

  -- ③ 그 외 사용자의 본인 행 — 화면 설정 칸만
  if new.id = v_uid then
    v_bad := array(select unnest(v_changed) except select unnest(c_self_allowed));
    if cardinality(v_bad) > 0 then
      raise exception '본인 계정에서 직접 바꿀 수 없는 항목입니다: %', array_to_string(v_bad, ', ')
        using errcode = '42501';
    end if;
    return new;
  end if;

  raise exception '다른 직원 계정을 바꿀 권한이 없습니다' using errcode = '42501';
end;
$$;
-- (트리거 함수는 직접 호출이 불가하고 발화 시 EXECUTE 권한을 보지 않는다 — 0026a처럼 실행권은 건드리지 않는다.)

drop trigger if exists tg_guard_user_privilege_columns on public.users;
create trigger tg_guard_user_privilege_columns
  before update on public.users
  for each row
  execute function public.guard_user_privilege_columns();

commit;
