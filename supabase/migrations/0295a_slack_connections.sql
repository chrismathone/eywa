-- 0295a — 슬랙(Slack) 알림 연결: 지점당 1행 (2026-09-28).
--
-- 왜: 원장 2026-09-28 *"jandi와 eywa 사이의 웹훅을 만들어 커넥트"* → 잔디는 공개 수단이 웹훅뿐이라 방마다 따로 연결하고
--     개인 채팅은 유료 + 토스랩 발급이었다 → *"그래 슬랙으로 가자"*(아직 쓰는 메신저 없음). 슬랙 봇 토큰 하나로
--     채널 여러 곳 + 받는 사람 본인에게 1:1을 무료 플랜에서 보낸다. 슈퍼관리자 '슬랙 알림 연결' 스위치
--     (tenant_licenses feature='slack', 기본 꺼짐)를 켠 지점만 쓴다.
-- 무엇을: bot_token = 슬랙 앱의 Bot User OAuth Token(xoxb-) · team_name = 연결된 워크스페이스 이름(표시용)
--         routes = 보낼 곳 목록 jsonb — [{kind:"dm", eventTypes:[…]}, {kind:"channel", channelId, channelName, eventTypes:[…]}]
--
-- 🔴 봇 토큰은 비밀번호와 같다(그 워크스페이스에 아무 글이나 올린다) → tenant_settings(같은 지점 전원이 읽는다)에 두지 않는다.
--    RLS는 켜되 **정책을 일부러 두지 않는다**(gotcha #104의 "의도적 제외"를 여기 적는다): 읽기·쓰기 모두 service_role
--    (학원 설정 서버 액션 — 원장·총괄 게이트 통과 후 · 알림 발송)만. 테이블 권한도 anon·authenticated에서 거둔다.
-- ⚠️ 앱은 이 파일 적용 전에도 산다([[#95]]): 스위치가 꺼져 있으면 표를 안 읽고, 켜면 설정 카드가 "DB 적용 전" 안내를 띄운다.
-- 🧹 같은 날 잠깐 만들었던 잔디 표(`jandi_webhooks`, main에 안 들어간 브랜치의 0294a 초안)와 잔디 스위치 행을 치운다.
-- 멱등: if exists / if not exists · revoke는 반복해도 같다.

begin;

drop table if exists public.jandi_webhooks;
delete from public.tenant_licenses where feature = 'jandi';

create table if not exists public.slack_connections (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  bot_token text not null default '',
  team_name text not null default '',
  routes jsonb not null default '[]'::jsonb,
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.slack_connections enable row level security;
revoke all on public.slack_connections from anon, authenticated;

commit;

notify pgrst, 'reload schema';
