-- 0358a — 키오스크 계열 표 쓰기를 '키오스크 설정' 쓰기 권한자로 좁힌다 (2026-10-13 키오스크 기기 삭제 리뷰 후속, [[#92]])
--
-- 배경: 키오스크 4표(kiosk_devices · kakao_channels · attendance_checkins · attendance_notifications)의 RLS가
-- **역할을 안 보는 tenant_isolation(for all) 하나**뿐이었다(0027a · 0029a). 그래서 강사 세션 JWT + 공개 anon 키로
-- PostgREST에 직접 쓰면 화면·서버 게이트(`canWriteTenant(…, "kiosk_settings")`)와 감사로그를 전부 우회해
--   · kiosk_devices INSERT — 토큰 해시를 스스로 만들어 **키오스크 자격을 발급**(그 쿠키로 아무 학생이나 등하원)
--   · attendance_checkins INSERT/UPDATE — 등하원 기록을 **직접 위조**
--   · kakao_channels UPSERT — 알림톡 발신 프로필·템플릿 바꿔치기
-- 가 가능했다. 이 파일이 DB 계층에서 닫는다.
--
-- 설계:
--  · kiosk_devices · kakao_channels — **쓰기(insert/update/delete)만** 제한(restrictive → 기존 permissive
--    tenant_isolation과 AND, 테넌트 격리 그대로). SELECT는 종전 그대로(키오스크 설정 화면이 세션으로 읽는다).
--    허용 = `auth_kiosk_can_write()` = 앱 `canWriteTenant(role, "kiosk_settings")`의 DB 미러(0305a
--    `auth_users_can_manage`와 같은 모양): `auth_menu_access('kiosk_settings')`(원장 상시 full · 개인 예외 ·
--    역할 override · 코드 기본값) + super_admin.
--    🔴 역할 명단(0219a 모양)으로 하지 않은 이유: 원장이 역할·권한 면에서 **화면으로 바로** 강사·뷰어에게 키오스크
--       설정을 줄 수 있다 → 명단이면 앱은 통과·DB는 거부가 되고, 폐기(update)는 오류 없이 0행이라 "폐기했습니다"가
--       뜨는데 기기는 살아 있는 거짓이 된다(리뷰 2026-10-13).
--    ⚠️ `auth_menu_access`의 DEFAULTS jsonb(0170a)에는 kiosk_settings 행이 없다 → 원장 외 'none'으로 떨어진다.
--       지금 코드 기본값(MENU_ACCESS.kiosk_settings)이 **원장만 full, 나머지 none**이라 결과가 같다. 코드 기본값을
--       바꾸면 0170a DEFAULTS에 kiosk_settings 행을 함께 넣을 것(가드 `permissions-sql-mirror.test.ts`).
--    ⚠️ '다른 강사 뷰'(열람 전용)·꺼진 모듈 캡은 앱 전용 상태라 DB가 모른다 — 그 캡은 앱 게이트가 계속 맡는다.
--  · attendance_checkins · attendance_notifications — 세션(authenticated)으로 **쓰는 코드가 하나도 없다**
--    (체크인 API `/api/attendance/checkin`과 알림 발송은 service_role). 그래서 for all 정책을 **읽기 전용**으로
--    바꾼다 = 세션 쓰기 전면 거부. 읽기(설정 화면의 최근 등하원·발송 로그)는 종전 그대로.
--  · admin(service_role) 클라이언트는 RLS 우회 — 체크인 API·기기 last_seen 갱신·알림 발송은 영향 없음.
--  · #91: 게이트 함수는 컬럼과 비교되지 않으므로 `(select …)`로 감싸 InitPlan 1회 평가.
--
-- 멱등: create or replace function + drop policy if exists → create. 정책·함수만 바꾸고 컬럼은 안 건드려
-- 앱 배포 순서와 무관(#95 안전) — 적용 전후 키오스크 설정 권한자의 화면 동작은 같다.
-- 되돌리기는 별도 요청(이 파일에 되돌리기 SQL을 두지 않는다).

begin;

-- ── 0. 사전 점검 — 전제가 빠졌으면 아무것도 바꾸지 않고 중단(0305a와 같은 점검) ─────────────────
do $chk$
begin
  if to_regprocedure('public.auth_menu_access(text)') is null then
    raise exception '0358a 중단: auth_menu_access(text)가 없습니다 — 0158a·0170a를 먼저 적용하세요';
  end if;
  if pg_get_functiondef('public.auth_menu_access(text)'::regprocedure) not like '%userOverrides%' then
    raise exception '0358a 중단: auth_menu_access가 개인 예외(userOverrides)를 모릅니다 — 0170a를 먼저 적용하세요';
  end if;
  if to_regprocedure('public.is_super_admin(uuid)') is null then
    raise exception '0358a 중단: is_super_admin(uuid)가 없습니다 — 0021a를 먼저 적용하세요';
  end if;
end $chk$;

-- ── 1. 게이트 함수 — 키오스크 설정 쓰기 권한자 ─────────────────────────────────────────────
create or replace function public.auth_kiosk_can_write() returns boolean
  language sql stable security definer set search_path = public as $fn$
  select coalesce(public.auth_menu_access('kiosk_settings'), 'none') in ('full', 'scoped')
      or coalesce(public.is_super_admin(auth.uid()), false)
$fn$;
revoke all on function public.auth_kiosk_can_write() from public, anon;
grant execute on function public.auth_kiosk_can_write() to authenticated, service_role;

-- ── 2. kiosk_devices · kakao_channels 쓰기 게이트 ─────────────────────────────────────────
do $$
declare
  t text;
  allowed constant text := '((select public.auth_kiosk_can_write()))';
begin
  foreach t in array array['kiosk_devices', 'kakao_channels'] loop
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

-- ── 3. attendance_checkins · attendance_notifications = 세션은 읽기만 ──────────────────────
do $$
declare t text;
begin
  foreach t in array array['attendance_checkins', 'attendance_notifications'] loop
    execute format('drop policy if exists %I_tenant_isolation on public.%I', t, t);
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format(
      'create policy %I_select on public.%I for select to authenticated using (tenant_id = public.auth_tenant_id())',
      t, t);
  end loop;
end $$;

commit;

-- 확인용(적용 뒤 — 읽기만 한다):
--   select tablename, policyname, permissive, cmd from pg_policies
--    where schemaname = 'public'
--      and tablename in ('kiosk_devices','kakao_channels','attendance_checkins','attendance_notifications')
--    order by tablename, policyname;
--   -- 기대: kiosk_devices·kakao_channels = tenant_isolation(ALL) + *_role_gate 3개(RESTRICTIVE)
--   --       attendance_checkins·attendance_notifications = *_select(SELECT) 하나씩
