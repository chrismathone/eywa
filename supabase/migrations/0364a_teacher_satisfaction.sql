-- 0364a — 강사평가 '학부모 만족도': 학부모 글·댓글 판정 + 원장이 넣는 클레임.
--
-- 원장 2026-10-13(계획서 3번 · 결정 8): ClassNote 학부모 글은 자동 판정(특정 문구) · 학원으로 온 클레임은 직접 입력 ·
-- "확실한 것은 즉시, 애매한 것은 확인 후" · 판정 취소(기록은 남는다) · 근거 문구를 그대로 보여 준다.
--
--  · teacher_satisfaction_judgments = 학부모 글 한 건에 판정 한 줄(글 하나는 한 번만 — 유니크). 출결 연락으로 분류된 글은 판정하지 않는다.
--    state: applied(반영) · pending(확인 대기) · dismissed(무시) · cancelled(반영했다가 취소) · none(판정 없음 — 다시 읽지 않게).
--    점수는 저장하지 않는다 — 그 달 설정(근거 문구의 점수)으로 매긴다(설정을 바꾸면 진행 중인 달만 다시 매겨진다).
--    누구 몫인지도 저장하지 않는다 — 그 글의 반(반 보드)·과목으로 그날 담임을 집계 때 찾는다(담임 이력, 다른 지표와 같은 축).
--  · teacher_satisfaction_claims = 원장이 넣는 클레임·칭찬(강사 · 날짜 · ± 점수 · 내용). 지우지 않고 취소로 남긴다.
--  · ⚠️ 두 표 모두 RLS는 켜되 정책을 만들지 않는다 — 서버(service_role)가 원장 게이트를 지난 뒤에만 읽고 쓴다(0359a와 같다).
--
-- 멱등 · 앱은 이 SQL 전에도 돈다(표가 없으면 만족도는 '계산 전'으로 남고 판정 작업은 건너뛴다 — #95).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table if not exists public.teacher_satisfaction_judgments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  message_id uuid not null references public.classnote_parent_messages(id) on delete cascade,
  student_id uuid references public.students(id) on delete set null,
  posted_on date not null,
  class_id uuid references public.classes(id) on delete set null,
  subjects text[] not null default '{}',
  verdict text check (verdict in ('plus', 'minus')),
  phrase text check (phrase is null or char_length(phrase) <= 60),
  reason text check (reason is null or char_length(reason) <= 120),
  method text not null check (method in ('rule', 'ai', 'manual')),
  state text not null check (state in ('applied', 'pending', 'dismissed', 'cancelled', 'none')),
  model text,
  decided_by uuid references public.users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  -- 반영된 판정엔 가점·감점이 있어야 한다.
  constraint teacher_satisfaction_judgments_applied_verdict check (state <> 'applied' or verdict is not null)
);
create unique index if not exists teacher_satisfaction_judgments_message_uidx on public.teacher_satisfaction_judgments (tenant_id, message_id);
create index if not exists teacher_satisfaction_judgments_tenant_day_idx on public.teacher_satisfaction_judgments (tenant_id, posted_on);
alter table public.teacher_satisfaction_judgments enable row level security;
revoke all on public.teacher_satisfaction_judgments from public, anon, authenticated;
grant all on public.teacher_satisfaction_judgments to service_role;
comment on table public.teacher_satisfaction_judgments is
  '강사평가 학부모 만족도 — 학부모 글 한 건의 판정(문구 · AI · 사람 확인). 점수는 그 달 설정으로 매긴다. service_role 전용.';

create table if not exists public.teacher_satisfaction_claims (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  teacher_id uuid not null references public.users(id) on delete cascade,
  student_id uuid references public.students(id) on delete set null,
  occurred_on date not null,
  points numeric(6,1) not null check (points between -100 and 100 and points <> 0),
  content text not null check (char_length(content) between 1 and 500),
  entered_by uuid references public.users(id) on delete set null,
  entered_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid references public.users(id) on delete set null
);
create index if not exists teacher_satisfaction_claims_tenant_day_idx on public.teacher_satisfaction_claims (tenant_id, occurred_on);
alter table public.teacher_satisfaction_claims enable row level security;
revoke all on public.teacher_satisfaction_claims from public, anon, authenticated;
grant all on public.teacher_satisfaction_claims to service_role;
comment on table public.teacher_satisfaction_claims is
  '강사평가 학부모 만족도 — 원장이 넣은 클레임·칭찬(± 점수). 지우지 않고 취소로 남긴다. service_role 전용.';

notify pgrst, 'reload schema';
commit;
