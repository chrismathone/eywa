-- 0313a — ClassNote **지금 반 보드 동기화** 요청 (2026-09-30, 원장 *"지금 반 보드 동기화 버튼을 만들자 … 한번 누르면
--          다른곳에서 누르지 못하도록 중복 발동 방지"* · *"너무 과부하 일어나지 않게 필요한것만 동기화하게"*).
--
-- 왜: 반 보드 동기화(새 반·반 이름·신입 배정·담임, 0302a 기록)는 연동 PC 워커가 **KST 05시 하루 1회**만 한다.
--     낮에 새 반을 만들거나 신입을 넣으면 다음 날 새벽까지 '보낼 반 없음'으로 막힌다. 앱(Vercel)은 ClassNote에
--     로그인할 수 없으므로 버튼은 **요청 행만** 남기고, 연동 PC 워커가 폴마다 집어 **바뀐 반만** 동기화한다.
--
-- 🔴 중복 발동 방지 = 지점당 **살아 있는 요청 하나**(부분 유니크 인덱스). 어느 화면에서 누르든 같은 행을 보므로,
--    한 곳에서 누르면 다른 곳의 버튼도 '요청됨'으로 잠긴다. ⚠️ 부분 유니크는 `ON CONFLICT` 타깃이 안 된다([[#113]]) —
--    앱은 **그냥 insert**하고 23505를 "이미 요청됨"으로 받아 살아 있는 요청을 돌려준다.
-- 🔴 쓰기 = 서버 액션(admin)·워커(service_role 직결)만 — 사용자 쓰기 정책을 두지 않는다(0304a와 같은 규약).
-- 앱은 이 SQL 전에도 죽지 않는다([[#95]]) — 표가 없으면 버튼을 그리지 않는다. 옛 워커는 이 표를 모른다(하트비트
-- caps.syncRequests가 없으면 앱이 요청을 받지 않는다 — 아무도 안 집는 '대기 중'이 생기지 않게).

create table if not exists public.classnote_sync_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  requested_by uuid references public.users(id) on delete set null,   -- 누가 눌렀나(감사로그와 별개로 화면 표시용)
  requested_at timestamptz not null default now(),
  -- 범위 — {"full": true} = 바뀐 반 전부(차이 계산) · {"classIds": [...], "studentIds": [...]} = 그 반·학생만.
  -- 대기 중에 다른 화면에서 또 누르면 새 행을 만들지 않고 이 칸에 합친다(merge_count로 낙관적 잠금).
  scope jsonb not null default '{"full": true}'::jsonb,
  merge_count integer not null default 0,
  -- 실행 중에 또 누른 범위 — 이번 실행엔 못 싣는다(워커가 집을 때 scope를 이미 읽었다). 워커가 끝내는 트랜잭션에서
  -- 이 값으로 **새 대기 요청**을 만들어 이어서 돈다(합류한 반이 새벽까지 밀리지 않게). null = 없음.
  next_scope jsonb,
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed')),
  started_at timestamptz,
  finished_at timestamptz,
  worker_id text,                    -- 집어 간 연동 PC 이름(hostname)
  result jsonb,                      -- 한글 요약 + 숫자(반 생성·이름 변경·배정·담임·보류·남은 반)
  error text                         -- 한글 사유(화면 표시). 원문은 result.raw에만
);

-- 표를 먼저 만든 뒤 칸이 늘었다(같은 날) — 다시 실행해도 안전하게.
alter table public.classnote_sync_requests add column if not exists next_scope jsonb;

-- 🔴 지점당 살아 있는 요청(대기·실행 중)은 하나뿐 — 여러 화면·여러 사람이 동시에 눌러도 DB가 하나로 막는다.
create unique index if not exists classnote_sync_requests_active_uniq
  on public.classnote_sync_requests (tenant_id) where status in ('pending', 'running');
create index if not exists classnote_sync_requests_recent_idx
  on public.classnote_sync_requests (tenant_id, requested_at desc);

alter table public.classnote_sync_requests enable row level security;

-- 읽기 = 테넌트 멤버(버튼 상태 표시). 쓰기 정책 없음 = service_role만([[#104]] — 정책 0개면 사용자 읽기도 0행이라 읽기는 연다).
drop policy if exists classnote_sync_requests_tenant_read on public.classnote_sync_requests;
create policy classnote_sync_requests_tenant_read on public.classnote_sync_requests
  for select using (tenant_id = auth_tenant_id());

-- 학생 계정은 못 읽는다(결과에 반 이름이 있다) — 0185a와 같은 restrictive 게이트. `(select …)`로 감싸 행마다 부르지 않는다([[#91]]).
drop policy if exists classnote_sync_requests_role_gate on public.classnote_sync_requests;
create policy classnote_sync_requests_role_gate on public.classnote_sync_requests
  as restrictive for select to authenticated
  using ((select coalesce(public.auth_system_role(), '')) <> 'student');

comment on table public.classnote_sync_requests is
  'ClassNote 지금 반 보드 동기화 요청(0313a). 지점당 살아 있는 요청 하나(부분 유니크). 쓰기 = 서버 액션·연동 PC 워커만.';

notify pgrst, 'reload schema';
