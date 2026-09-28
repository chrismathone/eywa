-- 0298a — 슬랙 연동 1단계: 규칙 · 인박스(같은 트랜잭션) · 아웃박스 · 사람 연결 (2026-09-28).
--
-- 왜: 원장 *"aywa에서 일어나는 상황들을 슬랙으로 보고받아서 바로 체크"* · *"생각할 만한 모든 것을 커스터마이징"* ·
--     *"완전한 슬랙<->aywa 연동기"* → codex·grok 설계 검토 합의(2026-09-28):
--   ① 발견 = **INSERT 트리거가 같은 트랜잭션에서 인박스에 한 줄**. `created_at` 커서는 쓰지 않는다
--      (`now()`는 트랜잭션 시작 시각이라 늦게 커밋된 행이 커서 뒤로 떨어져 영영 빠진다). 알림 27종·감사로그 전부 —
--      앱·DB 트리거·연동 PC 워커·스크립트 REST insert가 같은 그물에 걸린다.
--   ② 발송 = 아웃박스(`dedupe_key` UNIQUE = 같은 사건·규칙·대상은 한 번) + 지점 리스(동시 실행 방지) + 재시도·포기.
--   ③ 규칙 = 행 하나씩(`version`으로 동시 편집 충돌 감지). ④ 사람 = 명시 연결표(이메일 일치는 후보일 뿐).
-- 🔴 모든 표: RLS 켜고 **정책 0** + anon·authenticated 권한 회수 → service_role(서버)만([[#104]]의 "의도적 제외").
-- 🔴 트리거는 **원본 쓰기를 절대 막지 않는다** — 예외는 삼키고 원본 insert는 그대로 성공한다.
--    인박스엔 id만 넣는다(본문·metadata 복사 금지 — 민감값이 두 번째 표에 남지 않게).
-- ⚠️ 앱은 적용 전에도 산다([[#95]]): 슬랙 카드는 "DB 적용 전" 안내, 발송기는 표가 없으면 조용히 끝난다.
-- 멱등: if not exists · or replace · drop … if exists.

begin;

-- ── 연결(지점당 1행, 0297a) 확장 ────────────────────────────────────────────
alter table public.slack_connections
  add column if not exists team_id text,
  add column if not exists bot_user_id text,
  add column if not exists status text not null default 'active',          -- active | broken(토큰 폐기 등)
  add column if not exists dnd_enabled boolean not null default true,       -- 방해금지
  add column if not exists dnd_start time not null default '22:00',
  add column if not exists dnd_end time not null default '08:00',
  add column if not exists weekend_quiet boolean not null default false,    -- 토·일 종일 방해금지
  add column if not exists digest_at time not null default '08:00',         -- 기본 요약 시각(KST)
  add column if not exists lease_id uuid,
  add column if not exists lease_until timestamptz,
  add column if not exists last_dispatch_at timestamptz,
  add column if not exists last_error_code text,
  add column if not exists last_error_at timestamptz;
alter table public.slack_connections drop column if exists routes;           -- v1 보낼 곳(미배포) → slack_rules

-- ── 규칙 ────────────────────────────────────────────────────────────────
create table if not exists public.slack_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  enabled boolean not null default true,
  source text not null check (source in ('notification', 'activity')),
  type_keys text[] not null default '{}',              -- 알림 type 또는 감사 action — **명시 키**(분류는 화면용)
  targets jsonb not null default '[]'::jsonb,          -- [{kind:'channel',channelId,channelName}|{kind:'recipient_dm'}|{kind:'user_dm',userId,userName}]
  template text not null default 'short' check (template in ('short', 'detailed')),
  mention_recipients boolean not null default false,   -- 채널에서 받는 사람 @멘션
  ping text not null default 'none' check (ping in ('none', 'here', 'channel')),
  exclude_actor_ids uuid[] not null default '{}',
  timing text not null default 'immediate' check (timing in ('immediate', 'digest')),
  digest_at time,                                      -- null = 연결의 기본 요약 시각
  honor_dnd boolean not null default true,
  sort_order integer not null default 0,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null
);
create index if not exists slack_rules_tenant_idx on public.slack_rules (tenant_id);

-- ── 인박스(발견) ─────────────────────────────────────────────────────────
create table if not exists public.slack_inbox (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source text not null,                                -- notification | activity
  source_id uuid not null,
  created_at timestamptz not null default now(),
  status text not null default 'pending',              -- pending | processed | skipped
  processed_at timestamptz,
  unique (tenant_id, source, source_id)
);
create index if not exists slack_inbox_pending_idx on public.slack_inbox (tenant_id, id) where status = 'pending';

-- ── 아웃박스(발송) ───────────────────────────────────────────────────────
create table if not exists public.slack_outbox (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  rule_id uuid references public.slack_rules(id) on delete set null,
  inbox_id bigint references public.slack_inbox(id) on delete set null,
  dedupe_key text not null unique,                     -- inbox|rule|target — 같은 사건·규칙·대상은 한 번
  target jsonb not null,                               -- {kind:'channel',channelId} | {kind:'dm',slackUserId}
  kind text not null check (kind in ('message', 'digest_item')),
  body text not null,                                  -- 이미 걸러 낸 문자열(민감 필드 없음)
  group_label text not null default '',               -- 묶음 집계용 한 줄(예: "출결 입력·정정 — 박소선")
  due_at timestamptz not null,
  status text not null default 'pending',              -- pending | sent | dead | cancelled
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error_code text,
  slack_channel_id text,
  slack_ts text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists slack_outbox_due_idx on public.slack_outbox (tenant_id, due_at) where status = 'pending';

-- ── 사람 연결(aywa ↔ 슬랙) ────────────────────────────────────────────────
create table if not exists public.slack_user_links (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  aywa_user_id uuid not null references public.users(id) on delete cascade,
  slack_user_id text not null,
  slack_team_id text not null default '',
  method text not null check (method in ('code', 'owner_email')),  -- code = 본인 확인 · owner_email = 원장이 이메일 일치 확인
  linked_by uuid references public.users(id) on delete set null,
  linked_at timestamptz not null default now(),
  primary key (tenant_id, aywa_user_id),
  unique (tenant_id, slack_user_id)
);

create table if not exists public.slack_link_codes (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  aywa_user_id uuid not null references public.users(id) on delete cascade,
  slack_user_id text not null,
  code_hash text not null,
  attempts integer not null default 0,
  expires_at timestamptz not null,
  primary key (tenant_id, aywa_user_id)
);

-- 🔴 비밀·내부 표 — 정책 0 + 권한 회수
alter table public.slack_rules enable row level security;
alter table public.slack_inbox enable row level security;
alter table public.slack_outbox enable row level security;
alter table public.slack_user_links enable row level security;
alter table public.slack_link_codes enable row level security;
revoke all on public.slack_rules, public.slack_inbox, public.slack_outbox,
  public.slack_user_links, public.slack_link_codes from anon, authenticated;

-- ── 인박스 트리거 ────────────────────────────────────────────────────────
-- 켠 지점(슬랙 스위치 ∧ 연결 active ∧ 그 키를 고른 켜진 규칙)만 인박스에 넣는다 — 출결 한 칸마다 쌓이지 않게.
-- security definer: 앱의 logAction은 authenticated 세션으로 audit_logs에 쓰는데, 인박스는 권한이 회수돼 있다.
create or replace function public.slack_enqueue_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source text := tg_argv[0];
  v_key text := to_jsonb(new) ->> tg_argv[1];
begin
  begin
    if v_key is not null
      and exists (
        select 1 from public.slack_rules r
        where r.tenant_id = new.tenant_id and r.enabled and r.source = v_source and v_key = any (r.type_keys)
      )
      and exists (
        select 1 from public.slack_connections c
        where c.tenant_id = new.tenant_id and c.bot_token <> '' and c.status = 'active'
      )
      and exists (
        select 1 from public.tenant_licenses l
        where l.tenant_id = new.tenant_id and l.feature = 'slack' and l.is_active
          and (l.expires_at is null or l.expires_at > now())
      )
    then
      insert into public.slack_inbox (tenant_id, source, source_id)
      values (new.tenant_id, v_source, new.id)
      on conflict do nothing;
    end if;
  exception when others then
    null; -- 🔴 슬랙 연동 문제로 원본 쓰기를 막지 않는다
  end;
  return new;
end;
$$;
revoke all on function public.slack_enqueue_event() from public, anon, authenticated;

drop trigger if exists slack_enqueue_notifications on public.notifications;
create trigger slack_enqueue_notifications
  after insert on public.notifications
  for each row execute function public.slack_enqueue_event('notification', 'type');

drop trigger if exists slack_enqueue_activity on public.audit_logs;
create trigger slack_enqueue_activity
  after insert on public.audit_logs
  for each row execute function public.slack_enqueue_event('activity', 'action');

commit;

notify pgrst, 'reload schema';
