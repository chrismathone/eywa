-- 0343a — 보강 원장 1/5: 정책 버전 · 케이스 · 원사건 근거
--
-- 목적: 결석·휴강·추가 지도에서 접수한 보강 건을 예약 취소·기한 경과·반 이동 뒤에도 남기는 원장.
--   의무(케이스) · 예정 회차(0343b) · 실제 참여와 인정(0343c)을 따로 적는다. 0264a `makeup_reservations`
--   (출결 화면의 예약 표)는 그대로 두고, 연결된 예약만 0349a의 보호 트리거가 지킨다.
--
-- 🔴 이 표들은 **직접 쓰지 않는다** — authenticated·anon에 권한이 없고(0343e), service_role은 읽기만 한다.
--    쓰기는 `public.makeup_command()`(0347a) 하나뿐이다. 그래서 사용자 참조 칸(owner_id 등)의 같은 학원
--    검증은 명령이 맡고, 학생·반·케이스·참여 사이의 학원/학생/과목 일치는 복합 FK가 DB에서 막는다.
-- 🔴 케이스·회차·배정은 지우지 않는다(0343e 삭제 금지 트리거). 원반·학생 행이 지워지려 하면 FK가 막는다.
-- ⚠️ 앱은 이 SQL 적용 전에도 종전대로 돈다([[#95]]) — 설정 기본값이 꺼짐이라 기존 화면은 이 표를 읽지 않는다.
-- 멱등: create … if not exists. 되돌리기: 별도 요청(원장을 지우는 롤백은 두지 않는다).

create schema if not exists makeup_private;
revoke all on schema makeup_private from public, anon, authenticated;

-- 교차 학원 참조 봉쇄 — 0157a가 만든 (tenant_id, id) 유니크에 건다(멱등 재보장).
create unique index if not exists classes_tenant_id_id_uq on public.classes (tenant_id, id);
create unique index if not exists students_tenant_id_id_uq on public.students (tenant_id, id);

-- 정책 버전 — 승인 케이스에 고정되는 불변 스냅샷. 고치지 않고 새 버전을 더한다.
create table if not exists public.makeup_policy_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  revision integer not null default 1,
  label text not null constraint makeup_policy_label_len check (char_length(btrim(label)) between 1 and 80),
  effective_from date not null,
  unit_kind text not null default 'minutes' constraint makeup_policy_unit_chk check (unit_kind = 'minutes'),
  allowed_reasons text[] not null default '{}',
  -- 자기 검토 · 추가 지도의 수납 기준은 운영 결정 전이라 첫 출시에서는 값 자체를 막는다(설정 화면만 꺼 두는 것으로는 부족하다).
  self_verify boolean not null default false constraint makeup_policy_no_self_verify check (not self_verify),
  -- 자동 승인·자동 기한소멸은 첫 출시에서 켤 수 없다(값 자체를 막는다).
  auto_approve boolean not null default false constraint makeup_policy_no_auto_approve check (not auto_approve),
  auto_expire boolean not null default false constraint makeup_policy_no_auto_expire check (not auto_expire),
  -- 추가 지도의 출결 반·청구 처리 — 정해지기 전(undecided)에는 예약 확정을 서버가 거절한다.
  additional_billing text not null default 'undecided'
    constraint makeup_policy_additional_chk check (additional_billing in ('undecided', 'no_charge', 'attendance_units'))
    constraint makeup_policy_additional_pilot_chk check (additional_billing = 'undecided'),
  note text constraint makeup_policy_note_len check (note is null or char_length(note) <= 500),
  approved_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint makeup_policy_versions_tenant_id_uq unique (tenant_id, id)
);
create index if not exists makeup_policy_versions_effective_idx
  on public.makeup_policy_versions (tenant_id, effective_from desc, created_at desc);

create table if not exists public.makeup_cases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  revision integer not null default 1,
  student_id uuid not null,
  subject_key text not null constraint makeup_cases_subject_chk check (subject_key ~ '^[a-z0-9_]{1,24}$'),
  -- 원수업(결석·휴강이 난 반과 날짜). 추가 지도에는 둘 다 없다 — 가짜 결석일을 만들지 않는다.
  original_class_id uuid,
  original_date date,
  -- 원사건 키(서버 도출). 접수 경로(source)와 사유(reason)는 유일성에 넣지 않는다.
  occurrence_key text not null constraint makeup_cases_occurrence_len check (char_length(occurrence_key) between 3 and 200),
  reason text not null
    constraint makeup_cases_reason_chk check (reason in ('absence', 'planned_absence', 'class_cancelled', 'additional', 'imported')),
  eligibility text not null default 'pending'
    constraint makeup_cases_eligibility_chk check (eligibility in ('pending', 'approved', 'denied')),
  lifecycle text not null default 'open'
    constraint makeup_cases_lifecycle_chk check (lifecycle in ('open', 'on_hold', 'closed')),
  closure_reason text constraint makeup_cases_closure_chk check (closure_reason in
    ('completed', 'completed_with_waiver', 'denied', 'waived', 'duplicate', 'source_retracted')),
  unit_kind text not null default 'minutes' constraint makeup_cases_unit_chk check (unit_kind = 'minutes'),
  -- 승인된 목표 분량. 검토 중에는 null(0과 미확정을 구별한다).
  target_minutes integer constraint makeup_cases_target_range check (target_minutes between 1 and 6000),
  -- 아래 넷은 자식 표에서 다시 계산해 넣는 값이다(0345a recompute_case). 손으로 더하지 않는다.
  adjusted_minutes integer not null default 0,
  recognized_minutes integer not null default 0 constraint makeup_cases_recognized_nonneg check (recognized_minutes >= 0),
  waived_minutes integer not null default 0 constraint makeup_cases_waived_nonneg check (waived_minutes >= 0),
  committed_minutes integer not null default 0 constraint makeup_cases_committed_nonneg check (committed_minutes >= 0),
  -- 남은 의무 = 목표 + 조정 - 인정 - 면제. 목표가 없으면 null.
  outstanding_minutes integer generated always as
    (target_minutes + adjusted_minutes - recognized_minutes - waived_minutes) stored,
  policy_version_id uuid,
  owner_id uuid references public.users(id) on delete set null,
  due_date date,
  note text constraint makeup_cases_note_len check (note is null or char_length(note) <= 1000),
  absence_planned boolean not null default false,
  -- 이미 약속해 둔 기존 예약에서 온 건(승인 전에도 일정이 살아 있다).
  imported_commitment boolean not null default false,
  hold_reason text constraint makeup_cases_hold_reason_len check (hold_reason is null or char_length(hold_reason) <= 500),
  hold_review_at date,
  merged_into uuid,
  created_by uuid references public.users(id) on delete set null,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint makeup_cases_tenant_id_uq unique (tenant_id, id),
  constraint makeup_cases_identity_uq unique (tenant_id, student_id, subject_key, id),
  -- 같은 원수업은 케이스 하나 — 동시에 접수해도 한 건이다.
  constraint makeup_cases_occurrence_uq unique (tenant_id, occurrence_key),
  constraint makeup_cases_student_fk foreign key (tenant_id, student_id) references public.students (tenant_id, id),
  constraint makeup_cases_class_fk foreign key (tenant_id, original_class_id) references public.classes (tenant_id, id),
  constraint makeup_cases_policy_fk foreign key (tenant_id, policy_version_id)
    references public.makeup_policy_versions (tenant_id, id),
  constraint makeup_cases_merged_fk foreign key (tenant_id, merged_into) references public.makeup_cases (tenant_id, id),
  constraint makeup_cases_origin_chk check (
    (reason = 'additional' and original_class_id is null and original_date is null)
    or (reason <> 'additional' and original_class_id is not null and original_date is not null)),
  constraint makeup_cases_approved_target_chk check ((eligibility = 'approved') = (target_minutes is not null)),
  constraint makeup_cases_approved_policy_chk check (eligibility <> 'approved' or policy_version_id is not null),
  constraint makeup_cases_closed_reason_chk check ((lifecycle = 'closed') = (closure_reason is not null)),
  constraint makeup_cases_merged_self_chk check (merged_into is null or merged_into <> id),
  -- 음수 잔량을 0으로 숨기지 않는다 — 넘치는 인정·면제·조정은 여기서 실패한다.
  constraint makeup_cases_outstanding_nonneg check (
    target_minutes is null or target_minutes + adjusted_minutes - recognized_minutes - waived_minutes >= 0),
  -- 점유는 남은 의무를 넘지 않는다(예약 가능량이 음수가 되지 않는다).
  constraint makeup_cases_committed_within check (
    target_minutes is null
    or committed_minutes <= target_minutes + adjusted_minutes - recognized_minutes - waived_minutes)
);
comment on table public.makeup_cases is
  '보강 케이스(0343a) — 원수업 하나에 대한 보강 의무. 직접 쓰지 않는다(makeup_command 전용). 출결·시수·청구와 별개 장부.';
create index if not exists makeup_cases_open_idx on public.makeup_cases (tenant_id, lifecycle, eligibility, updated_at desc);
create index if not exists makeup_cases_student_idx on public.makeup_cases (tenant_id, student_id);
create index if not exists makeup_cases_owner_idx on public.makeup_cases (tenant_id, owner_id) where lifecycle <> 'closed';
create index if not exists makeup_cases_origin_idx on public.makeup_cases (tenant_id, student_id, original_date);
create index if not exists makeup_cases_class_idx on public.makeup_cases (tenant_id, original_class_id);

-- 원사건 근거 — 출결·예약·수동 접수·이관이 같은 원수업이면 같은 케이스에 별칭으로 붙는다.
create table if not exists public.makeup_case_sources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  revision integer not null default 1,
  case_id uuid not null,
  source_kind text not null
    constraint makeup_case_sources_kind_chk check (source_kind in ('attendance', 'reservation', 'manual', 'import')),
  source_id text not null constraint makeup_case_sources_id_len check (char_length(source_id) between 1 and 200),
  source_revision text,
  evidence text not null default 'exact'
    constraint makeup_case_sources_evidence_chk check (evidence in ('exact', 'probable', 'manual_review')),
  -- 접수 당시 원본 스냅샷과 해시. 시간표 이동·시각 변경으로 다시 만들지 않는다.
  snapshot jsonb not null default '{}'::jsonb,
  source_hash text not null,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint makeup_case_sources_tenant_id_uq unique (tenant_id, id),
  constraint makeup_case_sources_source_uq unique (tenant_id, source_kind, source_id),
  constraint makeup_case_sources_case_fk foreign key (tenant_id, case_id) references public.makeup_cases (tenant_id, id)
);
create index if not exists makeup_case_sources_case_idx on public.makeup_case_sources (tenant_id, case_id);
