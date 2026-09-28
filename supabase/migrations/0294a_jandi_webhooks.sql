-- 0294a — 잔디(JANDI) 인커밍 웹훅: 지점당 1행 (2026-09-28, 잔디 연결 1단계).
--
-- 왜: 원장 2026-09-28 *"jandi와 eywa 사이의 웹훅을 만들어 커넥트"* → 1단계 = aywa 알림 중 원장이 고른 종류를
--     그 지점의 잔디 방 하나로 보낸다. 슈퍼관리자 '잔디 알림 연결' 스위치(tenant_licenses feature='jandi', 기본 꺼짐)를
--     켠 지점만 쓴다.
-- 무엇을: webhook_url = 잔디가 발급한 인커밍 웹훅 주소 · event_types = 보낼 알림 종류(notifications.type 값).
--
-- 🔴 웹훅 주소 자체가 비밀번호다(주소만 알면 그 방에 아무 글이나 올린다) → tenant_settings(같은 지점 전원이 읽는다)에
--    두지 않고 이 표로 뺐다. RLS는 켜되 **정책을 일부러 두지 않는다**(gotcha #104의 "의도적 제외"를 여기 적는다):
--    읽기·쓰기 모두 service_role(학원 설정 서버 액션 — 원장·총괄 게이트 통과 후 · 알림 발송)만.
--    테이블 권한도 anon·authenticated에서 거둔다(정책 누락으로 열리는 사고의 이중 방어).
-- ⚠️ 앱은 이 파일 적용 전에도 산다([[#95]]): 발송은 조회 실패를 삼키고, 설정 카드는 "DB 적용 전" 안내를 띄운다.
-- 멱등: create table if not exists · revoke는 반복해도 같다.

begin;

create table if not exists public.jandi_webhooks (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  webhook_url text not null default '',
  event_types text[] not null default '{}',
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.jandi_webhooks enable row level security;
revoke all on public.jandi_webhooks from anon, authenticated;

commit;

notify pgrst, 'reload schema';
