-- 0157a: English Class Sheet(ECS) — 반별 주간 수업계획서/출석부 저장소 + 구조변경 RPC (2026-07-29).
--
-- 배경: 영어팀은 반마다 구글시트 1개(28개 반, 주차 탭 매주 복제)로 출석부/수업계획서를 운영해 왔다.
-- eywa 네이티브 재구현(원장 확정). 시트 구조 = 요일×교시 블록(수업계획: 시기 평시/내신 × 구분 skillArea ×
-- [교재·페이지·진도·과제] 여러 줄 + 학생 로스터[출석·상태·개인 진도]) + 담임/부담임 월간·주간 목표.
--
-- 설계 결정(계획 v2.2, 3차 검수 반영):
--  · 앵커 = 실날짜 plan_date + slot_start(time). class_schedules.id FK 금지(valid_from/to 교체·분절 시 소실),
--    교시번호 저장 금지(교시는 표시 파생). 지난 주 시트는 시간표가 바뀌어도 불변.
--  · 계획 행 식별 = id(uuid). 위치 제약 UNIQUE(...term_mode, line_no)는 skill_area를 **제외**(편집 가능한 값이
--    키에 들어가면 upsert가 유령 행을 만든다) + **DEFERRABLE INITIALLY IMMEDIATE**(이동/재번호 RPC가 함수 안에서
--    deferred). ⚠️ DEFERRABLE UNIQUE는 ON CONFLICT 대상 불가 → 모든 insert는 WHERE NOT EXISTS(락 아래라 경쟁 없음).
--  · 학생 마크 키에 slot_start 포함(같은 학생이 하루 두 교시 수강 시 교시별 기록 독립 — 시트 실물과 일치).
--  · subject 컬럼 없음 — classes.subject 파생(과목 키 rename/absorb 표면 확장 회피).
--
-- 🔒 보안: RLS는 켜되 **정책 0개**(0114a daily_briefings 선례보다 넓은 대상) + PUBLIC/anon/authenticated
--    **명시 revoke**. 접근은 서버 admin client(service_role) 전용 — 권한 매트릭스(override)·강사 스코프는
--    앱 레이어(requireEcsClassAccess)에 있어 SQL로 미러하면 취약하다. 브라우저 anon 키 REST 우회 차단(#77).
--    RPC도 전부 p_tenant/p_actor 신뢰 주입 + 정확한 시그니처로 revoke → service_role만 execute.
--  · 교차 테넌트 참조 봉쇄: classes/students (tenant_id, id) unique 인덱스 + ECS 복합 FK.
--
-- 롤백: drop table class_sheet_* cascade + drop function ecs_* (앱 배포 전이면 무해).
-- ⚠️ drizzle journal 밖(손수 alpha). 신규 DB는 pnpm db:alphas가 사전순 적용.

-- ── 0. 복합 FK 대상 unique 인덱스 (멱등, 기존 PK와 별개) ──────────────────────
create unique index if not exists classes_tenant_id_id_uq on classes (tenant_id, id);
create unique index if not exists students_tenant_id_id_uq on students (tenant_id, id);

-- ── 1. 주간 수업계획 줄 ──────────────────────────────────────────────────────
create table if not exists class_sheet_plan_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  class_id uuid not null,
  plan_date date not null,
  slot_start time not null,             -- 그 교시 블록의 start_time 복사(진실원본은 시각)
  term_mode text not null default 'regular' check (term_mode in ('regular','exam')), -- 평시/내신
  skill_area text not null check (skill_area ~ '^[a-z0-9_]{1,24}$'), -- settings subjects[].skillAreas[].key (일반 편집 컬럼)
  line_no smallint not null check (line_no between 1 and 20),
  textbook text check (char_length(textbook) <= 500),
  page_range text check (char_length(page_range) <= 500),
  progress text check (char_length(progress) <= 500),
  homework text check (char_length(homework) <= 500),
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'class_sheet_plan_lines_class_fk') then
    alter table class_sheet_plan_lines
      add constraint class_sheet_plan_lines_class_fk
      foreign key (tenant_id, class_id) references classes (tenant_id, id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'class_sheet_plan_lines_pos_uq') then
    alter table class_sheet_plan_lines
      add constraint class_sheet_plan_lines_pos_uq
      unique (tenant_id, class_id, plan_date, slot_start, term_mode, line_no)
      deferrable initially immediate;
  end if;
end $$;

create index if not exists class_sheet_plan_lines_class_date_idx
  on class_sheet_plan_lines (tenant_id, class_id, plan_date);

-- ── 2. 담임/부담임 월간·주간 목표 ────────────────────────────────────────────
create table if not exists class_sheet_goals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  class_id uuid not null,
  scope text not null check (scope in ('month','week')),
  period_start date not null,           -- month=1일 / week=월요일 (CHECK로 강제)
  role text not null check (role in ('homeroom','assistant')), -- 담임/부담임
  skill_area text not null check (skill_area ~ '^[a-z0-9_]{1,24}$'),
  textbook text check (char_length(textbook) <= 500),
  target_progress text check (char_length(target_progress) <= 500),
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint class_sheet_goals_period_ck check (
    (scope = 'week' and extract(isodow from period_start) = 1)
    or (scope = 'month' and extract(day from period_start) = 1)
  ),
  unique (tenant_id, class_id, scope, period_start, role, skill_area)
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'class_sheet_goals_class_fk') then
    alter table class_sheet_goals
      add constraint class_sheet_goals_class_fk
      foreign key (tenant_id, class_id) references classes (tenant_id, id) on delete cascade;
  end if;
end $$;

create index if not exists class_sheet_goals_class_period_idx
  on class_sheet_goals (tenant_id, class_id, period_start);

-- ── 3. 학생별 마크(상태·개인 진도) — 교시 단위 ───────────────────────────────
-- 출석 체크는 여기 없음 — attendance_records(기존)로 배선(ecs_mark_present_if_absent).
-- status는 enum이 아닌 자유 라벨('완'/'결석'/'안침' 등 — 운영 어휘 진화 허용, UI가 칩 제안). LWW.
create table if not exists class_sheet_student_marks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  class_id uuid not null,
  student_id uuid not null,
  mark_date date not null,
  slot_start time not null,             -- 교시 포함(같은 학생 하루 2교시 독립 기록)
  status text check (char_length(status) <= 50),
  progress_note text check (char_length(progress_note) <= 500), -- "PL 7, 20개 / PV 4" 등 자유기입
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, class_id, student_id, mark_date, slot_start)
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'class_sheet_student_marks_class_fk') then
    alter table class_sheet_student_marks
      add constraint class_sheet_student_marks_class_fk
      foreign key (tenant_id, class_id) references classes (tenant_id, id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'class_sheet_student_marks_student_fk') then
    alter table class_sheet_student_marks
      add constraint class_sheet_student_marks_student_fk
      foreign key (tenant_id, student_id) references students (tenant_id, id) on delete cascade;
  end if;
end $$;

create index if not exists class_sheet_student_marks_class_date_idx
  on class_sheet_student_marks (tenant_id, class_id, mark_date);

-- ── 4. 자유 메모 ─────────────────────────────────────────────────────────────
create table if not exists class_sheet_memos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  class_id uuid not null,
  week_start date not null check (extract(isodow from week_start) = 1), -- 월요일
  memo_key text not null,               -- 'week' | 'panel' | 'day:<date>' | 'slot:<date>:<HH:MM>'
  body text not null default '' check (char_length(body) <= 2000),
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint class_sheet_memos_key_ck check (
    memo_key in ('week','panel')
    or (memo_key ~ '^day:\d{4}-\d{2}-\d{2}$'
        and to_date(substring(memo_key from 5 for 10), 'YYYY-MM-DD') between week_start and week_start + 6)
    or (memo_key ~ '^slot:\d{4}-\d{2}-\d{2}:\d{2}:\d{2}$'
        and to_date(substring(memo_key from 6 for 10), 'YYYY-MM-DD') between week_start and week_start + 6)
  ),
  unique (tenant_id, class_id, week_start, memo_key)
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'class_sheet_memos_class_fk') then
    alter table class_sheet_memos
      add constraint class_sheet_memos_class_fk
      foreign key (tenant_id, class_id) references classes (tenant_id, id) on delete cascade;
  end if;
end $$;

-- ── 5. updated_at 트리거 (0001a tg_set_updated_at 재사용) ────────────────────
drop trigger if exists class_sheet_plan_lines_set_updated_at on class_sheet_plan_lines;
create trigger class_sheet_plan_lines_set_updated_at
  before update on class_sheet_plan_lines
  for each row execute function public.tg_set_updated_at();

drop trigger if exists class_sheet_goals_set_updated_at on class_sheet_goals;
create trigger class_sheet_goals_set_updated_at
  before update on class_sheet_goals
  for each row execute function public.tg_set_updated_at();

drop trigger if exists class_sheet_student_marks_set_updated_at on class_sheet_student_marks;
create trigger class_sheet_student_marks_set_updated_at
  before update on class_sheet_student_marks
  for each row execute function public.tg_set_updated_at();

drop trigger if exists class_sheet_memos_set_updated_at on class_sheet_memos;
create trigger class_sheet_memos_set_updated_at
  before update on class_sheet_memos
  for each row execute function public.tg_set_updated_at();

-- ── 6. RLS(정책 0개) + 정밀 revoke/grant — service_role 전용 ─────────────────
alter table class_sheet_plan_lines enable row level security;
alter table class_sheet_goals enable row level security;
alter table class_sheet_student_marks enable row level security;
alter table class_sheet_memos enable row level security;
-- 정책 없음(의도) — 헤더 주석 참조. select 정책도 만들지 않는다.

revoke all on table class_sheet_plan_lines from public, anon, authenticated;
revoke all on table class_sheet_goals from public, anon, authenticated;
revoke all on table class_sheet_student_marks from public, anon, authenticated;
revoke all on table class_sheet_memos from public, anon, authenticated;
grant all on table class_sheet_plan_lines to service_role;
grant all on table class_sheet_goals to service_role;
grant all on table class_sheet_student_marks to service_role;
grant all on table class_sheet_memos to service_role;

-- ── 7. 헬퍼: 슬롯 advisory 락(트랜잭션 스코프 — pooling 안전) + 의미 판정 ─────
-- ⚠️ '의미 있는 행' 정의는 TS `isMeaningfulPlanLine`(src/features/class-sheets/lib/plan-codec.ts)과
--    동일해야 한다(Vitest가 동치 검증). 한쪽만 고치지 말 것.
create or replace function public.ecs_is_meaningful_line(
  p_textbook text, p_page_range text, p_progress text, p_homework text
) returns boolean
language sql immutable
as $$
  select nullif(btrim(coalesce(p_textbook, '')), '') is not null
      or nullif(btrim(coalesce(p_page_range, '')), '') is not null
      or nullif(btrim(coalesce(p_progress, '')), '') is not null
      or nullif(btrim(coalesce(p_homework, '')), '') is not null;
$$;

create or replace function public.ecs_slot_lock(
  p_tenant uuid, p_class uuid, p_date date, p_slot time
) returns void
language sql
as $$
  select pg_advisory_xact_lock(
    hashtextextended(p_tenant::text || '|' || p_class::text || '|' || p_date::text || '|' || p_slot::text, 42)
  );
$$;

-- ── 8. RPC: 계획 행 구조변경 (create/move/delete) ────────────────────────────
create or replace function public.ecs_create_plan_line(
  p_tenant uuid, p_actor uuid, p_class uuid,
  p_plan_date date, p_slot_start time, p_term_mode text, p_skill_area text
) returns setof class_sheet_plan_lines
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_next smallint;
begin
  perform ecs_slot_lock(p_tenant, p_class, p_plan_date, p_slot_start);
  select coalesce(max(line_no), 0) + 1 into v_next
  from class_sheet_plan_lines
  where tenant_id = p_tenant and class_id = p_class
    and plan_date = p_plan_date and slot_start = p_slot_start and term_mode = p_term_mode;
  if v_next > 20 then
    raise exception 'ECS_MAX_LINES';
  end if;
  insert into class_sheet_plan_lines
    (tenant_id, class_id, plan_date, slot_start, term_mode, skill_area, line_no, updated_by)
  select p_tenant, p_class, p_plan_date, p_slot_start, p_term_mode, p_skill_area, v_next, p_actor
  where not exists (
    select 1 from class_sheet_plan_lines
    where tenant_id = p_tenant and class_id = p_class
      and plan_date = p_plan_date and slot_start = p_slot_start
      and term_mode = p_term_mode and line_no = v_next
  );
  return query
    select * from class_sheet_plan_lines
    where tenant_id = p_tenant and class_id = p_class
      and plan_date = p_plan_date and slot_start = p_slot_start
    order by term_mode, line_no;
end;
$$;

create or replace function public.ecs_move_plan_line(
  p_tenant uuid, p_actor uuid, p_line_id uuid, p_term_mode text, p_line_no smallint
) returns setof class_sheet_plan_lines
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row class_sheet_plan_lines%rowtype;
  v_count int;
  v_target smallint;
begin
  if p_term_mode not in ('regular','exam') then
    raise exception 'ECS_BAD_TERM_MODE';
  end if;
  select * into v_row from class_sheet_plan_lines
  where id = p_line_id and tenant_id = p_tenant;
  if not found then
    raise exception 'ECS_LINE_NOT_FOUND';
  end if;
  perform ecs_slot_lock(p_tenant, v_row.class_id, v_row.plan_date, v_row.slot_start);
  set constraints class_sheet_plan_lines_pos_uq deferred;
  -- 옛 그룹에서 제거(뒤 행 당김)
  update class_sheet_plan_lines
    set line_no = line_no - 1
  where tenant_id = p_tenant and class_id = v_row.class_id
    and plan_date = v_row.plan_date and slot_start = v_row.slot_start
    and term_mode = v_row.term_mode and line_no > v_row.line_no;
  -- 대상 그룹 크기(이동 행 제외) → 목표 위치 클램프
  select count(*) into v_count from class_sheet_plan_lines
  where tenant_id = p_tenant and class_id = v_row.class_id
    and plan_date = v_row.plan_date and slot_start = v_row.slot_start
    and term_mode = p_term_mode and id <> p_line_id;
  v_target := least(greatest(p_line_no, 1), (v_count + 1))::smallint;
  if v_target > 20 then
    raise exception 'ECS_MAX_LINES';
  end if;
  -- 대상 그룹 자리 비우기(뒤 행 밀기)
  update class_sheet_plan_lines
    set line_no = line_no + 1
  where tenant_id = p_tenant and class_id = v_row.class_id
    and plan_date = v_row.plan_date and slot_start = v_row.slot_start
    and term_mode = p_term_mode and id <> p_line_id and line_no >= v_target;
  update class_sheet_plan_lines
    set term_mode = p_term_mode, line_no = v_target, updated_by = p_actor
  where id = p_line_id and tenant_id = p_tenant;
  return query
    select * from class_sheet_plan_lines
    where tenant_id = p_tenant and class_id = v_row.class_id
      and plan_date = v_row.plan_date and slot_start = v_row.slot_start
    order by term_mode, line_no;
end;
$$;

create or replace function public.ecs_delete_plan_line(
  p_tenant uuid, p_line_id uuid
) returns setof class_sheet_plan_lines
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row class_sheet_plan_lines%rowtype;
begin
  select * into v_row from class_sheet_plan_lines
  where id = p_line_id and tenant_id = p_tenant;
  if not found then
    -- 이미 삭제됨(멱등) — 빈 결과 대신 아무 슬롯도 모른 채 종료할 수 없어 그냥 빈 set 반환
    return;
  end if;
  perform ecs_slot_lock(p_tenant, v_row.class_id, v_row.plan_date, v_row.slot_start);
  set constraints class_sheet_plan_lines_pos_uq deferred;
  delete from class_sheet_plan_lines where id = p_line_id and tenant_id = p_tenant;
  update class_sheet_plan_lines
    set line_no = line_no - 1
  where tenant_id = p_tenant and class_id = v_row.class_id
    and plan_date = v_row.plan_date and slot_start = v_row.slot_start
    and term_mode = v_row.term_mode and line_no > v_row.line_no;
  return query
    select * from class_sheet_plan_lines
    where tenant_id = p_tenant and class_id = v_row.class_id
      and plan_date = v_row.plan_date and slot_start = v_row.slot_start
    order by term_mode, line_no;
end;
$$;

-- ── 9. RPC: 지난주 복사 (교시 단위 skip, 원자) ───────────────────────────────
-- 복사 대상 = '의미 있는 행'만. placeholder-only 대상 슬롯은 placeholder 삭제 후 1..N 재번호로 복사.
-- 대상 주 스케줄에 없는 (요일,시각)은 복사하지 않고 unmapped로 보고(고아 복사 금지).
-- 주간 goals(scope='week')도 함께 fill-empty 복사.
create or replace function public.ecs_copy_week(
  p_tenant uuid, p_actor uuid, p_class uuid, p_from_monday date, p_to_monday date
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  r record;
  v_copied int := 0;
  v_rc int;
  v_skipped jsonb := '[]'::jsonb;
  v_unmapped jsonb := '[]'::jsonb;
  v_target_date date;
  v_dow day_of_week;
begin
  if extract(isodow from p_from_monday) <> 1 or extract(isodow from p_to_monday) <> 1 then
    raise exception 'ECS_COPY_NOT_MONDAY';
  end if;
  if p_to_monday - p_from_monday <> 7 then
    raise exception 'ECS_COPY_NOT_NEXT_WEEK';
  end if;

  for r in
    select distinct plan_date, slot_start
    from class_sheet_plan_lines
    where tenant_id = p_tenant and class_id = p_class
      and plan_date >= p_from_monday and plan_date < p_from_monday + 7
    order by plan_date, slot_start   -- 다중 슬롯 락은 정렬 순서로 획득(데드락 방지)
  loop
    v_target_date := r.plan_date + 7;
    perform ecs_slot_lock(p_tenant, p_class, v_target_date, r.slot_start);

    -- 원본에 의미 있는 행이 없으면(placeholder-only) 복사 대상 아님
    if not exists (
      select 1 from class_sheet_plan_lines
      where tenant_id = p_tenant and class_id = p_class
        and plan_date = r.plan_date and slot_start = r.slot_start
        and ecs_is_meaningful_line(textbook, page_range, progress, homework)
    ) then
      continue;
    end if;

    -- 대상 주 스케줄에 (요일,시각) 슬롯이 실재하는지 — 없으면 unmapped
    v_dow := (array['mon','tue','wed','thu','fri','sat','sun'])[extract(isodow from v_target_date)]::day_of_week;
    if not exists (
      select 1 from class_schedules s
      where s.tenant_id = p_tenant and s.class_id = p_class
        and s.day_of_week = v_dow and s.start_time = r.slot_start
        and s.valid_from <= v_target_date
        and (s.valid_to is null or s.valid_to >= v_target_date)
    ) then
      v_unmapped := v_unmapped || to_jsonb(v_target_date::text || ' ' || r.slot_start::text);
      continue;
    end if;

    -- 대상 교시에 의미 있는 행이 하나라도 있으면 교시 통째 skip
    if exists (
      select 1 from class_sheet_plan_lines
      where tenant_id = p_tenant and class_id = p_class
        and plan_date = v_target_date and slot_start = r.slot_start
        and ecs_is_meaningful_line(textbook, page_range, progress, homework)
    ) then
      v_skipped := v_skipped || to_jsonb(v_target_date::text || ' ' || r.slot_start::text);
      continue;
    end if;

    -- placeholder-only 대상 행은 삭제 후 재번호 복사(line_no 충돌 방지)
    delete from class_sheet_plan_lines
    where tenant_id = p_tenant and class_id = p_class
      and plan_date = v_target_date and slot_start = r.slot_start;

    insert into class_sheet_plan_lines
      (tenant_id, class_id, plan_date, slot_start, term_mode, skill_area, line_no,
       textbook, page_range, progress, homework, updated_by)
    select p_tenant, p_class, v_target_date, s.slot_start, s.term_mode, s.skill_area,
           (row_number() over (partition by s.term_mode order by s.line_no, s.created_at))::smallint,
           s.textbook, s.page_range, s.progress, s.homework, p_actor
    from class_sheet_plan_lines s
    where s.tenant_id = p_tenant and s.class_id = p_class
      and s.plan_date = r.plan_date and s.slot_start = r.slot_start
      and ecs_is_meaningful_line(s.textbook, s.page_range, s.progress, s.homework);
    get diagnostics v_rc = row_count;
    v_copied := v_copied + v_rc;
  end loop;

  -- 주간 목표 fill-empty 복사(빈 키만 — 이미 있는 (role,skill_area)는 보존)
  insert into class_sheet_goals
    (tenant_id, class_id, scope, period_start, role, skill_area, textbook, target_progress, updated_by)
  select g.tenant_id, g.class_id, 'week', p_to_monday, g.role, g.skill_area, g.textbook, g.target_progress, p_actor
  from class_sheet_goals g
  where g.tenant_id = p_tenant and g.class_id = p_class
    and g.scope = 'week' and g.period_start = p_from_monday
    and (nullif(btrim(coalesce(g.textbook, '')), '') is not null
         or nullif(btrim(coalesce(g.target_progress, '')), '') is not null)
    and not exists (
      select 1 from class_sheet_goals t
      where t.tenant_id = g.tenant_id and t.class_id = g.class_id
        and t.scope = 'week' and t.period_start = p_to_monday
        and t.role = g.role and t.skill_area = g.skill_area
    );
  get diagnostics v_rc = row_count;

  return jsonb_build_object(
    'copied', v_copied,
    'goalsCopied', v_rc,
    'skippedSlots', v_skipped,
    'unmapped', v_unmapped
  );
end;
$$;

-- ── 10. RPC: 출석 present 생성(비파괴·원자) ──────────────────────────────────
-- ECS에서 허용되는 유일한 출석 조작 = "기록 없음 → present". 어떤 기록이든 이미 있으면 no-op.
-- 삭제·상태 변경·메모·시수는 /attendance 전용. check+insert가 락 아래 단일 트랜잭션이라 경쟁 시에도 중복 없음.
create or replace function public.ecs_mark_present_if_absent(
  p_tenant uuid, p_actor uuid, p_class uuid, p_student uuid, p_date date
) returns setof attendance_records
language plpgsql
security invoker
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(
    hashtextextended('ecs-att|' || p_tenant::text || '|' || p_class::text || '|' || p_student::text || '|' || p_date::text, 42)
  );
  insert into attendance_records
    (tenant_id, class_id, student_id, session_date, status, recorded_by, access_method)
  select p_tenant, p_class, p_student, p_date, 'present'::attendance_status, p_actor, 'manual'::attendance_access_method
  where not exists (
    select 1 from attendance_records a
    where a.tenant_id = p_tenant and a.class_id = p_class
      and a.student_id = p_student and a.session_date = p_date
  );
  return query
    select * from attendance_records a
    where a.tenant_id = p_tenant and a.class_id = p_class
      and a.student_id = p_student and a.session_date = p_date
    order by a.recorded_at;
end;
$$;

-- ── 11. 함수 정밀 revoke/grant — service_role만 execute (0114a:68 선례) ──────
revoke all on function public.ecs_is_meaningful_line(text, text, text, text) from public, anon, authenticated;
revoke all on function public.ecs_slot_lock(uuid, uuid, date, time) from public, anon, authenticated;
revoke all on function public.ecs_create_plan_line(uuid, uuid, uuid, date, time, text, text) from public, anon, authenticated;
revoke all on function public.ecs_move_plan_line(uuid, uuid, uuid, text, smallint) from public, anon, authenticated;
revoke all on function public.ecs_delete_plan_line(uuid, uuid) from public, anon, authenticated;
revoke all on function public.ecs_copy_week(uuid, uuid, uuid, date, date) from public, anon, authenticated;
revoke all on function public.ecs_mark_present_if_absent(uuid, uuid, uuid, uuid, date) from public, anon, authenticated;
grant execute on function public.ecs_is_meaningful_line(text, text, text, text) to service_role;
grant execute on function public.ecs_slot_lock(uuid, uuid, date, time) to service_role;
grant execute on function public.ecs_create_plan_line(uuid, uuid, uuid, date, time, text, text) to service_role;
grant execute on function public.ecs_move_plan_line(uuid, uuid, uuid, text, smallint) to service_role;
grant execute on function public.ecs_delete_plan_line(uuid, uuid) to service_role;
grant execute on function public.ecs_copy_week(uuid, uuid, uuid, date, date) to service_role;
grant execute on function public.ecs_mark_present_if_absent(uuid, uuid, uuid, uuid, date) to service_role;

comment on table class_sheet_plan_lines is 'ECS 반별 주간 수업계획 줄. 앵커=실날짜+슬롯시각, 행 식별=id(위치 UNIQUE에 skill_area 제외·DEFERRABLE). service_role 전용(RLS 정책 0).';
comment on table class_sheet_goals is 'ECS 담임/부담임 월간·주간 목표(영역별 교재·목표진도). LWW. service_role 전용.';
comment on table class_sheet_student_marks is 'ECS 학생별 교시 마크(상태 자유라벨·개인 진도). 출석은 attendance_records(별도). LWW. service_role 전용.';
comment on table class_sheet_memos is 'ECS 주간 자유 메모(위치키: week|panel|day:date|slot:date:time). LWW. service_role 전용.';
comment on function public.ecs_copy_week(uuid, uuid, uuid, date, date) is 'ECS 지난주→이번주 복사. 의미행 있는 대상 교시 skip, placeholder 재번호, 대상 주 스케줄 밖 슬롯 unmapped, 주간 goals fill-empty. execute=service_role만.';
comment on function public.ecs_mark_present_if_absent(uuid, uuid, uuid, uuid, date) is 'ECS 출석 체크(비파괴) — 그 날짜 기록이 하나도 없을 때만 present 생성, 있으면 no-op+canonical 반환. execute=service_role만.';

notify pgrst, 'reload schema';
