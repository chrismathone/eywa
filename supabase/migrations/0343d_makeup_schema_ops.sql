-- 0343d — 보강 원장 4/5: 이벤트 · 명령 멱등 원장 · 기존 예약 연결 · 반영 작업 · 대사
--
-- 이벤트 = 상태 변화의 불변 기록(업무 쓰기와 같은 트랜잭션). 명령 = 같은 요청 재시도에 같은 결과를 돌려주는
-- 원장. 연결 = 학생별 참여·배정과 0264a 예약 행의 관계. 반영 작업 = 출결 쪽에서 관측됐지만 아직 원장에
-- 반영되지 않은 효과(pending/failed). 대사 = 사람이 확인해야 끝나는 불일치.
-- 🔴 실패·지연을 0건이나 완료로 보이지 않게 하는 표다 — 반영 작업과 열린 대사는 케이스 종결을 막는다.
-- 멱등: create … if not exists.

create table if not exists public.makeup_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  revision integer not null default 1,
  entity_type text not null constraint makeup_events_entity_chk check (entity_type in
    ('case', 'session', 'participant', 'allocation', 'fulfillment', 'recognition', 'adjustment',
     'policy', 'settings', 'reconciliation', 'projection', 'legacy')),
  entity_id uuid not null,
  case_id uuid,
  session_id uuid,
  event_type text not null constraint makeup_events_type_len check (char_length(event_type) between 1 and 60),
  -- 실제로 입력한 사람(대리입력이면 데스크). 시스템 관측(트리거)은 null.
  actor_id uuid references public.users(id) on delete set null,
  -- 같은 명령에서 나온 이벤트를 묶는 상관 키(= command_id).
  command_id uuid,
  from_revision integer,
  to_revision integer,
  reason text constraint makeup_events_reason_len check (reason is null or char_length(reason) <= 500),
  data jsonb not null default '{}'::jsonb,
  -- 실제 시계: 한 명령(한 트랜잭션) 안의 이벤트도 일어난 순서대로 읽힌다.
  occurred_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists makeup_events_case_idx on public.makeup_events (tenant_id, case_id, occurred_at desc);
create index if not exists makeup_events_session_idx on public.makeup_events (tenant_id, session_id, occurred_at desc);
create index if not exists makeup_events_command_idx on public.makeup_events (tenant_id, command_id);

create table if not exists public.makeup_commands (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  revision integer not null default 1,
  command_id uuid not null,
  action text not null,
  actor_id uuid references public.users(id) on delete set null,
  -- 정규화한 payload의 해시 — 같은 command_id를 다른 내용·다른 사람이 다시 쓰면 충돌로 거절한다.
  payload_hash text not null,
  expected_revision integer,
  result jsonb not null,
  -- 결과가 닿은 케이스 — 재시도 때 지금 권한으로 다시 본다.
  case_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint makeup_commands_command_uq unique (tenant_id, command_id)
);

create table if not exists public.makeup_legacy_maps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  revision integer not null default 1,
  legacy_kind text not null constraint makeup_legacy_maps_kind_chk check (legacy_kind = 'reservation'),
  legacy_id uuid not null,
  case_id uuid not null,
  participant_id uuid,
  allocation_id uuid,
  -- imported = 기존 예약을 원장에 연결 · projected = 원장 예약을 출결 화면용 예약 행으로 투영.
  direction text not null constraint makeup_legacy_maps_direction_chk check (direction in ('imported', 'projected')),
  -- 연결 당시 원본 스냅샷과 체크섬. 원본이 바뀌면 재검토 대상이다(무조건 no-op 아님).
  snapshot jsonb not null,
  checksum text not null,
  native_effect_key text not null,
  target_revision integer not null default 1,
  -- active = 보호 대상(직접 수정·삭제 금지) · released = 일정이 취소·변경돼 연결이 끝남(스냅샷은 남는다).
  state text not null default 'active' constraint makeup_legacy_maps_state_chk check (state in ('active', 'released')),
  batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint makeup_legacy_maps_tenant_id_uq unique (tenant_id, id),
  -- 한 참여에 케이스가 여럿이면 예약 1건에 연결 행이 케이스 수만큼 붙는다.
  constraint makeup_legacy_maps_pair_uq unique (tenant_id, legacy_kind, legacy_id, case_id),
  constraint makeup_legacy_maps_case_fk foreign key (tenant_id, case_id) references public.makeup_cases (tenant_id, id),
  constraint makeup_legacy_maps_participant_fk foreign key (tenant_id, participant_id)
    references public.makeup_participants (tenant_id, id),
  constraint makeup_legacy_maps_allocation_fk foreign key (tenant_id, allocation_id)
    references public.makeup_allocations (tenant_id, id)
);
create index if not exists makeup_legacy_maps_legacy_idx
  on public.makeup_legacy_maps (legacy_kind, legacy_id) where state = 'active';
create index if not exists makeup_legacy_maps_participant_idx on public.makeup_legacy_maps (tenant_id, participant_id);

create table if not exists public.makeup_projection_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  revision integer not null default 1,
  kind text not null constraint makeup_projection_jobs_kind_chk check (kind in ('attendance_effect', 'legacy_reservation', 'effect_gap')),
  -- 같은 효과는 한 줄 — 재시도는 이 키로 같은 줄을 다시 연다.
  effect_key text not null,
  case_id uuid,
  participant_id uuid,
  -- 한 작업이 여러 케이스·참여에 닿을 때(관측 실패 등) 전부 적는다 — 닿은 케이스 모두의 종결을 막는다.
  case_ids uuid[] not null default '{}',
  participant_ids uuid[] not null default '{}',
  state text not null default 'pending' constraint makeup_projection_jobs_state_chk check (state in ('pending', 'done', 'failed')),
  payload jsonb not null default '{}'::jsonb,
  attempts integer not null default 0,
  last_error text constraint makeup_projection_jobs_error_len check (last_error is null or char_length(last_error) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint makeup_projection_jobs_effect_uq unique (tenant_id, effect_key)
);
create index if not exists makeup_projection_jobs_state_idx on public.makeup_projection_jobs (tenant_id, state);
create index if not exists makeup_projection_jobs_participant_idx on public.makeup_projection_jobs (tenant_id, participant_id);

create table if not exists public.makeup_reconciliation (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  revision integer not null default 1,
  kind text not null constraint makeup_reconciliation_kind_chk check (kind in
    ('source_conflict', 'units_review', 'units_mismatch', 'timetable_conflict', 'evidence_removed',
     'owner_inactive', 'teacher_inactive', 'anchor_missing', 'legacy_done_review', 'legacy_multi_same_day',
     'legacy_checksum_conflict', 'attendance_observed', 'billing_review', 'handover_review', 'quantity_drift')),
  state text not null default 'open' constraint makeup_reconciliation_state_chk check (state in ('open', 'resolved', 'dismissed')),
  -- 열려 있는 동안 연결된 케이스의 종결을 막는가(시수 확인·근거 삭제 등).
  blocks_close boolean not null default false,
  -- 같은 문제를 다시 발견해도 한 줄(유니크). 내용이 달라지면 같은 줄을 다시 연다.
  dedupe_key text not null constraint makeup_reconciliation_key_len check (char_length(dedupe_key) between 3 and 300),
  case_id uuid,
  participant_id uuid,
  session_id uuid,
  -- 회차·학생 단위 항목이 닿는 케이스 전부(1:N). 목록·상세·종결 차단이 이 배열까지 본다.
  case_ids uuid[] not null default '{}',
  attendance_record_id uuid,
  legacy_id uuid,
  detail jsonb not null default '{}'::jsonb,
  resolved_by uuid references public.users(id) on delete set null,
  resolved_at timestamptz,
  resolution_note text constraint makeup_reconciliation_note_len check (resolution_note is null or char_length(resolution_note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint makeup_reconciliation_tenant_id_uq unique (tenant_id, id),
  constraint makeup_reconciliation_dedupe_uq unique (tenant_id, dedupe_key),
  constraint makeup_reconciliation_resolved_chk check ((state = 'open') = (resolved_at is null))
);
create index if not exists makeup_reconciliation_state_idx on public.makeup_reconciliation (tenant_id, state, kind);
create index if not exists makeup_reconciliation_case_idx on public.makeup_reconciliation (tenant_id, case_id);
create index if not exists makeup_reconciliation_participant_idx on public.makeup_reconciliation (tenant_id, participant_id);
create index if not exists makeup_reconciliation_session_idx on public.makeup_reconciliation (tenant_id, session_id);
