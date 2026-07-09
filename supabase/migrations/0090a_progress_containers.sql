-- 0090a: 진도 컨테이너 자동분석 (edutrix 이식) — 학생 진도를 글로벌 위치 기반 "현행/선행 컨테이너"에 담아
-- 속도·백분위·예측·이상감지(점프/역행/오버랩/분할)를 산출. ingest는 saveLessonReport 성공 후 동기 호출.
-- 위치 매핑은 앱단(curriculum-position.ts, 정확 차시 문자열 조회). 이 스키마는 컨테이너 상태 + 감사 이벤트.

create table if not exists progress_containers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  track text not null check (track in ('current','ahead')),
  sequence_number int not null default 1,           -- (student,track) 내 몇 번째 컨테이너
  grade_scope text,                                  -- 개시 시 진도 학년(예 "중2")
  start_position int,
  last_position int,
  chapter_count int not null default 0,              -- 담긴 엔트리(보고서) 수 — 20이면 정상 분할
  max_jump int not null default 0,
  status text not null default 'active' check (status in ('active','archived','errored')),
  error_reason text,                                 -- jump_error / overlap / full / manual
  archived_at timestamptz,
  opened_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists progress_containers_seq_key
  on progress_containers (student_id, track, sequence_number);
-- 학생×track당 활성 컨테이너 최대 1개(부분 unique).
create unique index if not exists progress_containers_active_key
  on progress_containers (student_id, track) where status = 'active';
create index if not exists progress_containers_student_idx on progress_containers (student_id, track, status);
create index if not exists progress_containers_tenant_idx on progress_containers (tenant_id);

create table if not exists progress_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  container_id uuid not null references progress_containers(id) on delete cascade,
  report_id uuid references lesson_reports(id) on delete set null,
  student_id uuid not null references students(id) on delete cascade,
  entry_date date not null,
  soft_chapter_name text,                            -- 차시 문자열
  global_position int,
  raw_progress text,                                 -- 원문 progress 텍스트
  created_at timestamptz not null default now()
);
create index if not exists progress_entries_container_idx on progress_entries (container_id, entry_date desc);
create index if not exists progress_entries_student_idx on progress_entries (student_id, entry_date desc);
-- 멱등: 보고서당 엔트리 1개(부분 unique). edutrix는 앱단만 — eywa는 DB로도 강제.
create unique index if not exists progress_entries_report_key
  on progress_entries (report_id) where report_id is not null;

create table if not exists progress_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  container_id uuid references progress_containers(id) on delete set null,
  related_container_id uuid references progress_containers(id) on delete set null,
  event_type text not null check (event_type in (
    'forward','regression','jump_error','overlap_error','container_opened','container_closed','manual_note')),
  from_position int,
  to_position int,
  jump_size int,
  report_id uuid references lesson_reports(id) on delete set null,
  details jsonb,
  actor text,
  created_at timestamptz not null default now()
);
create index if not exists progress_events_student_idx on progress_events (student_id, created_at desc);
create index if not exists progress_events_container_idx on progress_events (container_id, created_at desc);
create index if not exists progress_events_report_idx on progress_events (report_id) where report_id is not null;
-- 이벤트 중복 방지(복습 보고서 재저장) + logEvent upsert onConflict 타겟. 비부분(nulls distinct — report_id null은 서로 안 충돌).
create unique index if not exists progress_events_report_type_key on progress_events (report_id, event_type);

-- updated_at 자동 갱신(containers)
create or replace function touch_progress_containers_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;
drop trigger if exists trg_touch_progress_containers on progress_containers;
create trigger trg_touch_progress_containers before update on progress_containers
  for each row execute function touch_progress_containers_updated_at();

-- RLS: 테넌트 멤버가 자기 테넌트 진도데이터 read/insert, containers는 update(닫기/갱신). 0086a auth_tenant_id 패턴.
alter table progress_containers enable row level security;
alter table progress_entries enable row level security;
alter table progress_events enable row level security;

drop policy if exists progress_containers_tenant_sel on progress_containers;
create policy progress_containers_tenant_sel on progress_containers for select using (tenant_id = auth_tenant_id());
drop policy if exists progress_containers_tenant_ins on progress_containers;
create policy progress_containers_tenant_ins on progress_containers for insert with check (tenant_id = auth_tenant_id());
drop policy if exists progress_containers_tenant_upd on progress_containers;
create policy progress_containers_tenant_upd on progress_containers for update
  using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());

drop policy if exists progress_entries_tenant_sel on progress_entries;
create policy progress_entries_tenant_sel on progress_entries for select using (tenant_id = auth_tenant_id());
drop policy if exists progress_entries_tenant_ins on progress_entries;
create policy progress_entries_tenant_ins on progress_entries for insert with check (tenant_id = auth_tenant_id());

drop policy if exists progress_events_tenant_sel on progress_events;
create policy progress_events_tenant_sel on progress_events for select using (tenant_id = auth_tenant_id());
drop policy if exists progress_events_tenant_ins on progress_events;
create policy progress_events_tenant_ins on progress_events for insert with check (tenant_id = auth_tenant_id());
