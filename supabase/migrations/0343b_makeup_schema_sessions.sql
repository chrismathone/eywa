-- 0343b — 보강 원장 2/5: 회차 · 학생별 참여 · 배정(케이스 × 참여, N:M)
--
-- 회차 = 언제·어디서·누가 가르칠지 정한 일정 시도. 참여 = 그 회차의 학생 한 명. 배정 = 그 참여에 어느
-- 케이스의 몇 분을 걸었는지. 한 회차에 여러 학생이, 한 참여에 여러 원결석이 걸릴 수 있다.
-- 🔴 취소·변경은 행을 지우지 않는다 — 회차는 cancelled/rescheduled, 참여는 cancelled, 배정은 해제량으로 남는다.
-- 🔴 같은 학생·과목·날짜의 살아 있는 참여는 하나(부분 유니크). 둘째 보강은 다른 날짜로 잡는다.
--    ⚠️ 부분 유니크는 upsert 타겟으로 못 쓴다([[#113]]) — 명령은 먼저 조회한 뒤 insert만 한다.
-- 멱등: create … if not exists.

create table if not exists public.makeup_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  revision integer not null default 1,
  -- 합류하는 정규 반(같은 강의실에서 함께 받는 경우). 없으면 독립 회차.
  class_id uuid,
  -- 실제 가르칠 강사·장소. 기존 예약에서 온 회차(imported)만 비어 있을 수 있다.
  teacher_id uuid references public.users(id) on delete set null,
  classroom_id uuid references public.classrooms(id) on delete set null,
  subject_key text not null constraint makeup_sessions_subject_chk check (subject_key ~ '^[a-z0-9_]{1,24}$'),
  session_date date not null,
  -- 교시 시각 스냅샷 — 학원설정 교시표가 뒤에 바뀌어도 잡던 시각으로 읽힌다.
  start_time time not null,
  end_time time not null,
  period_ids text[] not null default '{}',
  period_label text constraint makeup_sessions_label_len check (period_label is null or char_length(period_label) <= 40),
  capacity integer constraint makeup_sessions_capacity_range check (capacity between 1 and 200),
  state text not null default 'confirmed'
    constraint makeup_sessions_state_chk check (state in ('confirmed', 'finished', 'cancelled', 'rescheduled')),
  -- 전원 노쇼로 끝난 회차는 finished + all_no_show(회차에 노쇼 상태를 두지 않는다).
  finish_reason text constraint makeup_sessions_finish_chk check (finish_reason is null or finish_reason = 'all_no_show'),
  cancel_reason text constraint makeup_sessions_cancel_len check (cancel_reason is null or char_length(cancel_reason) <= 500),
  cancel_cause text constraint makeup_sessions_cause_chk check (cancel_cause in ('student', 'academy', 'reschedule')),
  replaced_by_session_id uuid,
  imported boolean not null default false,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint makeup_sessions_tenant_id_uq unique (tenant_id, id),
  -- 참여가 회차의 과목·날짜와 같음을 복합 FK로 묶는 축.
  constraint makeup_sessions_axis_uq unique (tenant_id, id, subject_key, session_date),
  constraint makeup_sessions_slot_order check (end_time > start_time),
  constraint makeup_sessions_replaced_self_chk check (replaced_by_session_id is null or replaced_by_session_id <> id),
  constraint makeup_sessions_class_fk foreign key (tenant_id, class_id) references public.classes (tenant_id, id),
  constraint makeup_sessions_replaced_fk foreign key (tenant_id, replaced_by_session_id)
    references public.makeup_sessions (tenant_id, id)
);
comment on table public.makeup_sessions is
  '보강 회차(0343b). 출결 행이 아니다 — 시수·회차 소비·출석률에 닿지 않는다. 직접 쓰지 않는다(makeup_command 전용).';
create index if not exists makeup_sessions_date_idx on public.makeup_sessions (tenant_id, session_date);
create index if not exists makeup_sessions_teacher_idx on public.makeup_sessions (tenant_id, teacher_id, session_date);
create index if not exists makeup_sessions_room_idx on public.makeup_sessions (tenant_id, classroom_id, session_date);

create table if not exists public.makeup_participants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  revision integer not null default 1,
  session_id uuid not null,
  student_id uuid not null,
  subject_key text not null,
  session_date date not null,
  -- unknown = 아직 기록 전 · present/partial = 왔다 · no_show = 안 왔다 · cancelled = 이 학생 일정만 취소.
  status text not null default 'unknown'
    constraint makeup_participants_status_chk check (status in ('unknown', 'present', 'partial', 'no_show', 'cancelled')),
  planned_minutes integer not null constraint makeup_participants_planned_range check (planned_minutes between 1 and 600),
  actual_minutes integer constraint makeup_participants_actual_range check (actual_minutes between 0 and 600),
  -- 출결·보고서를 세울 반(원반). 유효한 반이 없으면 대사 큐에서 사람이 정한다.
  anchor_class_id uuid,
  -- 실제 출결 행 연결과 그 칸에 예상한 보강 시수(대사용). 이 표는 출결 행을 쓰지 않는다.
  attendance_record_id uuid references public.attendance_records(id) on delete set null,
  expected_makeup_units numeric(4,1),
  cancel_reason text constraint makeup_participants_cancel_len check (cancel_reason is null or char_length(cancel_reason) <= 500),
  recorded_by uuid references public.users(id) on delete set null,
  recorded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint makeup_participants_tenant_id_uq unique (tenant_id, id),
  constraint makeup_participants_identity_uq unique (tenant_id, student_id, subject_key, id),
  constraint makeup_participants_session_fk foreign key (tenant_id, session_id, subject_key, session_date)
    references public.makeup_sessions (tenant_id, id, subject_key, session_date),
  constraint makeup_participants_student_fk foreign key (tenant_id, student_id) references public.students (tenant_id, id),
  constraint makeup_participants_anchor_fk foreign key (tenant_id, anchor_class_id) references public.classes (tenant_id, id),
  constraint makeup_participants_came_chk check (status not in ('present', 'partial') or actual_minutes > 0),
  constraint makeup_participants_no_show_chk check (status <> 'no_show' or coalesce(actual_minutes, 0) = 0)
);
-- 같은 학생·과목·날짜의 살아 있는 참여는 하나(취소한 시도는 이력으로 남는다).
create unique index if not exists makeup_participants_one_per_day_uq
  on public.makeup_participants (tenant_id, student_id, subject_key, session_date) where status <> 'cancelled';
create index if not exists makeup_participants_session_idx on public.makeup_participants (tenant_id, session_id);
create index if not exists makeup_participants_student_date_idx
  on public.makeup_participants (tenant_id, student_id, session_date);
create index if not exists makeup_participants_attendance_idx
  on public.makeup_participants (attendance_record_id) where attendance_record_id is not null;

create table if not exists public.makeup_allocations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  revision integer not null default 1,
  case_id uuid not null,
  participant_id uuid not null,
  -- 케이스와 참여의 학생·과목이 같음을 복합 FK가 DB에서 강제한다(형제·다른 과목 결합 거절).
  student_id uuid not null,
  subject_key text not null,
  allocated_minutes integer not null constraint makeup_allocations_allocated_range check (allocated_minutes between 1 and 600),
  -- 인정으로 넘어간 분 · 취소/노쇼/부분 검증/반전으로 풀린 분. 살아 있는 점유 = 배정 - 인정 - 해제.
  recognized_minutes integer not null default 0 constraint makeup_allocations_recognized_nonneg check (recognized_minutes >= 0),
  released_minutes integer not null default 0 constraint makeup_allocations_released_nonneg check (released_minutes >= 0),
  release_reason text constraint makeup_allocations_release_chk check (release_reason in
    ('cancelled', 'rescheduled', 'no_show', 'partial_verify', 'reversed')),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint makeup_allocations_tenant_id_uq unique (tenant_id, id),
  constraint makeup_allocations_case_axis_uq unique (tenant_id, case_id, id),
  constraint makeup_allocations_participant_axis_uq unique (tenant_id, participant_id, id),
  constraint makeup_allocations_pair_uq unique (tenant_id, case_id, participant_id),
  constraint makeup_allocations_within_chk check (recognized_minutes + released_minutes <= allocated_minutes),
  constraint makeup_allocations_case_fk foreign key (tenant_id, student_id, subject_key, case_id)
    references public.makeup_cases (tenant_id, student_id, subject_key, id),
  constraint makeup_allocations_participant_fk foreign key (tenant_id, student_id, subject_key, participant_id)
    references public.makeup_participants (tenant_id, student_id, subject_key, id)
);
create index if not exists makeup_allocations_participant_idx on public.makeup_allocations (tenant_id, participant_id);
create index if not exists makeup_allocations_case_idx on public.makeup_allocations (tenant_id, case_id);
