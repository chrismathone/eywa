-- 0343c — 보강 원장 3/5: 실시 기록 · 케이스별 인정 · 조정/면제
--
-- 실시 기록 = 학생별 실제 참여의 근거(출결 행·보고서 연결, 작성자·검토자). 인정 = 그 실시가 어느 케이스의
-- 몇 분을 채웠는지(배정 단위). 조정 = 목표량 증감·면제·기한 변경의 결정 기록.
-- 🔴 인정·조정은 덧붙이기만 한다(0343e). 검토를 마친 기록을 고치는 길은 반전 행 + 새 버전뿐이다.
-- 🔴 이 표는 출결·시수·급여·청구를 쓰지 않는다. 출결 행·보고서는 **연결만** 한다(지워지면 연결만 끊긴다).
-- 멱등: create … if not exists.

create table if not exists public.makeup_fulfillments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  revision integer not null default 1,
  participant_id uuid not null,
  -- 반전 뒤 다시 적으면 버전이 오른다(옛 기록은 reversed로 남는다).
  version integer not null default 1 constraint makeup_fulfillments_version_chk check (version >= 1),
  state text not null default 'draft'
    constraint makeup_fulfillments_state_chk check (state in ('draft', 'submitted', 'returned', 'verified', 'reversed')),
  attendance_record_id uuid references public.attendance_records(id) on delete set null,
  report_id uuid references public.lesson_reports(id) on delete set null,
  actual_minutes integer constraint makeup_fulfillments_actual_range check (actual_minutes between 1 and 600),
  -- 무엇을 근거로 "왔다"고 기록했나: report(반 없는 보강 보고서) · manual(분 + 지도 근거 글) · attendance(정규 수업 없는 날의 출결).
  -- 정규 수업일의 출석은 근거가 아니다(관측일 뿐이다).
  evidence_kind text constraint makeup_fulfillments_evidence_chk check (evidence_kind in ('report', 'manual', 'attendance')),
  -- 실제로 가르친 강사와 입력한 사람은 다른 칸이다(데스크 대리입력이 귀속을 바꾸지 않는다).
  actual_teacher_id uuid references public.users(id) on delete set null,
  recorded_by uuid references public.users(id) on delete set null,
  submitted_by uuid references public.users(id) on delete set null,
  submitted_at timestamptz,
  verified_by uuid references public.users(id) on delete set null,
  verified_at timestamptz,
  learning_summary text constraint makeup_fulfillments_summary_len check (learning_summary is null or char_length(learning_summary) <= 2000),
  homework text constraint makeup_fulfillments_homework_len check (homework is null or char_length(homework) <= 1000),
  return_reason text constraint makeup_fulfillments_return_len check (return_reason is null or char_length(return_reason) <= 500),
  reverse_reason text constraint makeup_fulfillments_reverse_len check (reverse_reason is null or char_length(reverse_reason) <= 500),
  -- 실시 효과의 안정 키(참여 + 버전). 요청 UUID와 별개다.
  effect_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint makeup_fulfillments_tenant_id_uq unique (tenant_id, id),
  constraint makeup_fulfillments_participant_axis_uq unique (tenant_id, participant_id, id),
  constraint makeup_fulfillments_effect_uq unique (tenant_id, effect_key),
  constraint makeup_fulfillments_version_uq unique (tenant_id, participant_id, version),
  constraint makeup_fulfillments_participant_fk foreign key (tenant_id, participant_id)
    references public.makeup_participants (tenant_id, id),
  -- 검토자 칸은 직원 행이 지워지면 비므로(연결만 끊김) 시각만 강제한다.
  constraint makeup_fulfillments_verified_chk check (state <> 'verified' or verified_at is not null)
);
-- 한 참여의 살아 있는 실시 기록은 하나 · 한 보고서는 한 참여에만 연결된다.
create unique index if not exists makeup_fulfillments_one_live_uq
  on public.makeup_fulfillments (tenant_id, participant_id) where state <> 'reversed';
create unique index if not exists makeup_fulfillments_report_once_uq
  on public.makeup_fulfillments (tenant_id, report_id) where report_id is not null and state <> 'reversed';
create index if not exists makeup_fulfillments_state_idx on public.makeup_fulfillments (tenant_id, state);
create index if not exists makeup_fulfillments_attendance_idx
  on public.makeup_fulfillments (attendance_record_id) where attendance_record_id is not null;
create index if not exists makeup_fulfillments_report_idx
  on public.makeup_fulfillments (report_id) where report_id is not null;

create table if not exists public.makeup_recognitions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  revision integer not null default 1,
  fulfillment_id uuid not null,
  allocation_id uuid not null,
  case_id uuid not null,
  participant_id uuid not null,
  -- recognize = 인정 · reverse = 그 인정의 반전(원배분 그대로 한 번).
  kind text not null default 'recognize' constraint makeup_recognitions_kind_chk check (kind in ('recognize', 'reverse')),
  minutes integer not null constraint makeup_recognitions_minutes_range check (minutes between 1 and 600),
  -- 실시·배정·효과 종류의 안정 키 — 같은 효과를 다른 요청으로 다시 보내도 한 번만 들어간다.
  effect_key text not null,
  reversal_of uuid,
  reason text constraint makeup_recognitions_reason_len check (reason is null or char_length(reason) <= 500),
  decided_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint makeup_recognitions_tenant_id_uq unique (tenant_id, id),
  constraint makeup_recognitions_effect_uq unique (tenant_id, effect_key),
  constraint makeup_recognitions_reverse_chk check ((kind = 'reverse') = (reversal_of is not null)),
  -- 실시·배정이 같은 참여의 것이고, 배정이 그 케이스의 것임을 DB가 강제한다.
  constraint makeup_recognitions_fulfillment_fk foreign key (tenant_id, participant_id, fulfillment_id)
    references public.makeup_fulfillments (tenant_id, participant_id, id),
  constraint makeup_recognitions_allocation_fk foreign key (tenant_id, participant_id, allocation_id)
    references public.makeup_allocations (tenant_id, participant_id, id),
  constraint makeup_recognitions_case_fk foreign key (tenant_id, case_id, allocation_id)
    references public.makeup_allocations (tenant_id, case_id, id),
  constraint makeup_recognitions_reversal_fk foreign key (tenant_id, reversal_of)
    references public.makeup_recognitions (tenant_id, id)
);
-- 한 인정은 한 번만 반전된다.
create unique index if not exists makeup_recognitions_reverse_once_uq
  on public.makeup_recognitions (tenant_id, reversal_of) where reversal_of is not null;
create index if not exists makeup_recognitions_case_idx on public.makeup_recognitions (tenant_id, case_id);
create index if not exists makeup_recognitions_fulfillment_idx on public.makeup_recognitions (tenant_id, fulfillment_id);

create table if not exists public.makeup_adjustments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  revision integer not null default 1,
  case_id uuid not null,
  -- quantity = 목표량 증감(부호 있음) · waiver = 면제(양수) · due_date = 기한 변경.
  -- 면제는 waiver 한 곳에서만 뺀다 — 같은 분을 quantity와 waiver에 두 번 넣지 않는다.
  kind text not null constraint makeup_adjustments_kind_chk check (kind in ('quantity', 'waiver', 'due_date')),
  minutes integer,
  due_date_from date,
  due_date_to date,
  reason text not null constraint makeup_adjustments_reason_len check (char_length(btrim(reason)) between 1 and 500),
  policy_version_id uuid,
  decided_by uuid references public.users(id) on delete set null,
  effect_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint makeup_adjustments_tenant_id_uq unique (tenant_id, id),
  constraint makeup_adjustments_effect_uq unique (tenant_id, effect_key),
  constraint makeup_adjustments_case_fk foreign key (tenant_id, case_id) references public.makeup_cases (tenant_id, id),
  constraint makeup_adjustments_policy_fk foreign key (tenant_id, policy_version_id)
    references public.makeup_policy_versions (tenant_id, id),
  constraint makeup_adjustments_quantity_chk check (kind <> 'quantity' or (minutes is not null and minutes <> 0)),
  constraint makeup_adjustments_waiver_chk check (kind <> 'waiver' or (minutes is not null and minutes > 0)),
  constraint makeup_adjustments_due_chk check (kind <> 'due_date' or minutes is null)
);
create index if not exists makeup_adjustments_case_idx on public.makeup_adjustments (tenant_id, case_id);
