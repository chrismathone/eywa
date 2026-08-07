-- 0188a — 휴대폰(웹 푸시) 알림 구독 (2026-08-07).
--
-- 배경(원장 2026-08-07): *"셔틀 선생님으로 체크된 사용자만 알림을 모바일에서 받을 수 있으면 될것 같네.
-- pc 알림은 잘 작동하는것 같더라고"* — 즉 범위는 **`users.attendance_alert_optin`이 켜진 계정 + 출결 알림**뿐이다.
--
-- 왜 표가 필요한가: 지금 OS 알림은 `Notification` 생성자를 그대로 쓰는 얇은 래퍼라(desktop-notify.ts)
-- **브라우저 창이 열려 있을 때만** 뜬다. 게다가 안드로이드 크롬은 서비스워커 없이 만드는 그 알림을 아예
-- 지원하지 않아 폰에서는 창을 열어놔도 안 뜬다. 폰으로 받으려면 표준 웹 푸시(서비스워커 + 구독 + VAPID)가
-- 필요하고, 그 **구독 정보(엔드포인트·공개키·인증비밀)를 서버가 들고 있어야** 발송할 수 있다.
--
-- 🔴 이 행은 **그 기기로 알림을 밀어 넣을 수 있는 자격증명**이다(내용은 없지만, 새면 남이 그 폰에 알림을
--    쏠 수 있다). 그래서 RLS는 테넌트 격리로 끝내지 않고 **본인 행만** 보이게 잠근다(#92의 "계열 전체를
--    잠갔는지" 교훈). 발송은 서버(service_role)가 하므로 이 정책이 기능을 막지 않는다.
--
-- 옛 앱 호환(gotcha #95): **추가만** 한다. 이 표가 없어도 옛 앱은 그대로 돌고, 새 앱도 구독 UI만 조용히
-- 비활성으로 뜬다(라우트가 실패를 삼킨다) — 매일 쓰는 경로에는 이 표를 읽는 코드를 두지 않았다.

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,

  -- 브라우저가 준 구독 3종(엔드포인트 + 공개키 + 인증비밀). 기기·브라우저마다 하나씩 생긴다.
  endpoint text not null,
  p256dh text not null,
  auth text not null,

  -- 사람이 "어느 기기인지" 알아보게(끄기 UI에서 구분). 진단용이라 없으면 null.
  user_agent text,

  created_at timestamptz not null default now(),
  last_sent_at timestamptz,
  -- 구독이 죽었을 때(브라우저가 404/410으로 답한다) 기록하고 다음 발송에서 제외 → 표가 무한히 자라지 않는다.
  failed_at timestamptz,
  fail_reason text
);

-- 같은 기기가 다시 구독하면 새 행이 아니라 **갱신**이다(브라우저는 같은 endpoint를 돌려준다).
create unique index if not exists push_subscriptions_endpoint_idx on push_subscriptions (endpoint);
create index if not exists push_subscriptions_user_idx on push_subscriptions (tenant_id, user_id) where failed_at is null;

comment on table push_subscriptions is
  '웹 푸시 구독(기기별). 셔틀 등 attendance_alert_optin 계정이 휴대폰으로 출결 알림을 받기 위한 자격증명. 0188a.';

alter table push_subscriptions enable row level security;

-- 본인 것만 — 남의 구독을 읽으면 그 기기에 알림을 쏠 수 있다(자격증명 취급).
drop policy if exists push_subscriptions_self on push_subscriptions;
create policy push_subscriptions_self on push_subscriptions
  for all
  using (tenant_id = public.auth_tenant_id() and user_id = (select auth.uid()))
  with check (tenant_id = public.auth_tenant_id() and user_id = (select auth.uid()));
