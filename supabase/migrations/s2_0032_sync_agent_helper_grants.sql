-- s2_0032_sync_agent_helper_grants.sql — 연동 PC 역할(eywa_sync_agent)에 도우미 함수 실행권을 직접 준다 · 2026-11-06
--
-- 사고(2026-11-06 17:37~19:17): s2_0031(학원 비서)이 public 보안 정의자 함수의 PUBLIC 실행권을 거뒀다(그 거래 시각 17:37:44).
--   연동 PC는 게이트웨이 거래 안에서 eywa_sync_agent 역할로 조회한다(src/features/sync-agent/server/gateway.ts). 이 역할은 그 함수들을
--   PUBLIC으로만 부를 수 있었다 — 0406a는 겉함수 auth_tenant_id()·auth_system_role()만 줬고, 겉함수 속의 operator_view_tenant()·
--   auth_tenant_id_base()·auth_system_role_base()는 PUBLIC에 기댔다. textbook_orders 수정 정책은 auth_textbook_can_use()·auth_display_name()을 부른다.
--   → 첫 42501 기록 17:37:50(permission denied for function operator_view_tenant) — 연동 PC의 ClassNote 작업자 확인·신호 질의(classnote_workers)가
--   막혀 ClassNote 발송·학부모 글 감지가 멈췄고(마지막 발송 16:15 · 19:07 기준 대기 38건), 메이크에듀 모듈의 작업자 신호·요청 집기 질의도 막혔다.
--   (메이크에듀 스크래핑 동기화는 같은 날 06:00부터 별건 — 로그인 사람 확인(reCAPTCHA) · 40d598ac7 — 으로 실패 중이었다.)
-- 고침: s2_0031이 거둔 목록(assistant_private.revoked_public_execute)에서 비서 증표 발급 함수를 뺀 11개를 eywa_sync_agent에 명시로 준다
--   = 17:37 전 이 역할이 갖던 실행권 그대로. PUBLIC 회수는 그대로라 비서 역할(aywa_assistant)은 여전히 못 부른다
--   (aywa_assistant는 어떤 역할의 구성원도 아니다 · eywa_sync_agent의 구성원은 postgres뿐). 연동 PC는 게이트웨이의 고정 질의 목록만
--   실행한다(임의 SQL 없음 · 목록은 이 11개를 직접 부르지 않는다).
--   student_status_lifecycle(학생 상태 함수 소유자)은 authenticated의 구성원(상속)이라 11개를 그대로 실행할 수 있어 영향이 없었다 —
--   🔴 이 상속을 끊으면(inherit false) 그 역할이 소유한 정의자 함수가 같은 42501로 막힌다. auth 스키마 트리거 4개는 모두 보안 정의자(postgres).
--   함수 목록은 운영 기록(12줄 − 증표 발급 1)으로 고정했다 — 다른 DB에서 없는 함수는 알림만 남기고 건너뛴다.
-- 🔴 PUBLIC 실행권을 거두는 SQL을 쓰기 전에, anon·authenticated·service_role 밖의 역할(eywa_sync_agent · student_status_lifecycle ·
--    supabase_* 내부 역할)이 그 함수를 PUBLIC으로 부르는지 먼저 볼 것. 확인 순서 = ① 역할별 has_function_privilege ② 표 권한·BYPASSRLS
--    ③ 정책 → 겉함수 → 속함수 · 호출자 트리거 · 보기 · 기본값까지의 사슬 ④ SET ROLE이 되는 역할만 explain으로 정책 식 확인
--    (explain은 트리거·plpgsql 본문을 돌리지 않는다 · postgres는 supabase_privileged_role 말고는 supabase_* 역할로 SET ROLE 할 수 없다). 함정 #155.
-- 이미 운영에 적용함(2026-11-06 19:16 · 원장 *"수정할 수 있으면 빠르게 수정하고 적용시켜"*). 다시 돌려도 같은 결과(grant는 멱등).

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
do $$
declare
  f text;
begin
  if not exists (select from pg_roles where rolname = 'eywa_sync_agent') then
    raise notice 's2_0032: eywa_sync_agent 역할이 없어 건너뜀';
    return;
  end if;
  foreach f in array array[
    'public.operator_view_tenant()', 'public.auth_tenant_id_base()', 'public.auth_system_role_base()',
    'public.auth_display_name()', 'public.auth_textbook_can_use()', 'public.auth_staff_can_read()',
    'public.auth_menu_access(text)', 'public.auth_billing_can_read()', 'public.auth_billing_can_write()',
    'public.auth_expense_can_submit()', 'public.is_super_admin(uuid)'
  ] loop
    if to_regprocedure(f) is null then
      raise notice 's2_0032: % 없음 — 건너뜀', f;
    else
      execute format('grant execute on function %s to eywa_sync_agent', f);
    end if;
  end loop;
end $$;
commit;
