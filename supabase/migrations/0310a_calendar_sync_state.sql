-- 0310a — 구글 캘린더 푸시(웹훅) + 증분 동기화 상태 (2026-09-30, 원장 *"이벤트 발생할 때마다 동기화, 주기보다 웹훅같은걸로"*).
--
-- 왜: 캘린더 임포트가 하루 2회(06:00·18:00)뿐이라 구글에서 '[취소]'로 바꾼 입테가 반나절 동안 운영실에 남았다.
--     구글 푸시 채널(events.watch)이 "이 캘린더가 바뀌었다"를 알려 오면 바뀐 일정만(updatedMin) 가져와 반영한다.
--     하루 2회 전체 임포트는 안전망으로 그대로 둔다.
--   · 캘린더마다 한 줄: 채널 id·무작위 토큰(웹훅 검증)·리소스 id·만료 · 증분 시작점 · 동시 실행 잠금(running_since/dirty).
--   · 🔴 **의도적 제외 — 사용자 정책 없음**([[#92]]): 쓰기·읽기 모두 서버(service_role)만 한다(크론·웹훅).
--     채널 토큰이 들어 있어 앱 사용자에게 읽기를 열면 누구나 우리 웹훅을 위조할 수 있다. RLS를 켜고 정책을 두지 않는다
--     (= authenticated/anon 전부 거부), 권한도 service_role에만 준다.
-- 앱은 이 SQL 전에도 죽지 않는다([[#95]]) — 표가 없으면 웹훅·채널은 조용히 꺼지고 하루 2회 전체 임포트만 돈다.
-- ⚠️ 번호: 같은 날 다른 작업이 0308a·0309a를 써서 0310a로 뗐다(순서 의존 없음 — 이 표는 다른 표를 바꾸지 않는다).

create table if not exists public.calendar_sync_state (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  calendar_id text not null,              -- 구글 캘린더 id(env GOOGLE_CALENDAR_IDS의 값)
  channel_id text,                        -- 우리가 만든 푸시 채널 id(UUID)
  channel_token text,                     -- 채널마다 무작위 — 웹훅이 상수시간 비교로 확인
  resource_id text,                       -- 구글이 돌려준 리소스 id(채널 닫기·검증)
  channel_expires_at timestamptz,
  last_synced_at timestamptz,             -- 증분 시작점(이 시각 뒤 바뀐 일정만 받는다 — 여유 5분을 두고 뒤로)
  running_since timestamptz,              -- 동시 실행 잠금(5분 넘으면 죽은 것으로 본다)
  dirty boolean not null default false,   -- 도는 동안 새 알림이 옴 → 끝나고 한 번 더
  updated_at timestamptz not null default now(),
  primary key (tenant_id, calendar_id)
);
create unique index if not exists calendar_sync_state_channel_uniq
  on public.calendar_sync_state (channel_id) where channel_id is not null;

alter table public.calendar_sync_state enable row level security;
revoke all on public.calendar_sync_state from public, anon, authenticated;
grant select, insert, update, delete on public.calendar_sync_state to service_role;

comment on table public.calendar_sync_state is
  '구글 캘린더 푸시 채널·증분 동기화 상태(0310a). service_role 전용 — 사용자 정책 의도적 제외(채널 토큰 보호).';

notify pgrst, 'reload schema';
