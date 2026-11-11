-- s2_0060_delete_staff_account.sql — 직원 완전 삭제를 한 거래로: 잠금 → 삭제 차단 기록 검사 → 직원 행 → 로그인 계정 · 2026-11-11
-- ✅ 운영 적용 2026-11-11(거래 안 ROLLBACK 시험 뒤 적용 — 데모 지점에서 차단·삭제·다른 지점·데이터 전용 직원·보호 계정 다섯 갈래 확인).
--
-- 문제(Claude·Codex 검토 H1 + 2차 검토): 직원 완전 삭제는 두 시스템(로그인 계정 auth.users · 직원 행 public.users)을 따로 지웠다.
--   · 로그인 계정 먼저 → 직원 행 삭제가 FK에 막히면 로그인 계정만 사라진다(되돌릴 수 없다). 사전 검사를 넓혀도 검사와 삭제 사이에
--     새 기록이 끼어들면 같은 일이 난다.
--   · 직원 행 먼저 → 로그인 계정 삭제가 실패하면 로그인 계정이 남는데, auth → public 미러 트리거(tg_sync_user_from_auth)가
--     그 계정의 다음 갱신(로그인만 해도 app_metadata를 다시 쓴다) 때 **직원 행을 원래 역할로 되살린다**.
-- 고침: 둘을 **같은 거래에서** 지운다. 앱이 Auth 서버를 따로 부르지 않으므로 중간 상태가 없다 — 막히면 아무것도 안 지워진다.
--   ① 로그인 계정 → 직원 행 순서로 잠근다(Auth 서버의 갱신도 로그인 계정을 먼저 잡고 미러 트리거로 직원 행을 쓴다 — 같은 순서라 교착하지 않는다).
--      직원 행 잠금(FOR UPDATE)은 이 직원을 가리키는 새 기록의 FK 검사(KEY SHARE)를 기다리게 한다 → 검사와 삭제 사이에 끼어들지 못한다.
--   ② 삭제를 막는 기록(s2_0058 staff_delete_blockers)이 있으면 표 이름을 돌려주고 끝낸다(아무것도 안 지움 — 앱이 '퇴사(비활성)'를 안내).
--   ③ 직원 행을 지우고(급여·연차 cascade · 담임 set null — 종전과 같다) ④ 로그인 계정을 지운다(identities·sessions 등은 auth 쪽 FK cascade).
--      Auth 서버의 하드 삭제도 auth.users 행 삭제 한 번이다 — 같은 결과이고 Auth 감사로그 한 줄만 없다(앱 감사로그 staff_delete가 남는다).
--   보호 계정(super_admins)은 public.users·auth.users의 보호 트리거가 그대로 거절한다(P0001 — 거래째 되돌아간다).
-- 지점 확인: 직원 행이 그 지점에 없으면 not_found로 끝낸다(로그인 계정을 건드리지 않는다).
-- 보안 정의자: auth.users(소유자 supabase_auth_admin · 정책 0개)를 지워야 해서 소유자(postgres) 권한으로 돈다 · search_path 고정 · service_role만 실행.
--   앱 게이트(직원관리 쓰기 · 역할 계층 · 과목 범위 · 보호 계정)는 src/features/staff/server/account-actions.ts deleteStaff가 먼저 지난다.
-- 되돌리기 = scripts/_oneoff/revert-s2_0060-delete-staff-account.sql (앱을 먼저 되돌린 뒤)
create function public.delete_staff_account(p_tenant uuid, p_user uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_login boolean; v_tables text[];
begin
  perform 1 from auth.users u where u.id = p_user for update;
  v_login := found;
  perform 1 from public.users u where u.id = p_user and u.tenant_id = p_tenant for update;
  if not found then return pg_catalog.jsonb_build_object('status', 'not_found'); end if;
  select pg_catalog.array_agg(distinct b.table_name) into v_tables from public.staff_delete_blockers(p_user) b;
  if v_tables is not null then
    return pg_catalog.jsonb_build_object('status', 'blocked', 'tables', pg_catalog.to_jsonb(v_tables));
  end if;
  delete from public.users u where u.id = p_user and u.tenant_id = p_tenant;
  if v_login then delete from auth.users u where u.id = p_user; end if;
  return pg_catalog.jsonb_build_object('status', 'deleted', 'login', v_login);
end $$;
revoke all on function public.delete_staff_account(uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_staff_account(uuid, uuid) to service_role;
notify pgrst, 'reload schema';
