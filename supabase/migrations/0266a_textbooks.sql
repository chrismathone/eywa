-- 0266a — 교재목록(수업 교재 마스터) + 차수별 진도·과제 + 반 배정
--
-- 원장(2026-09-16): *"수업-> 교재목록 기능 추가하려고함. 교재는 구분, 교재이름, 페이지/시간, 진도,
-- 과제, 차수로 구성 … 차수가 10차수 면 차수마다 진도 과제 10차수 모두 작성할수있어야함 … 해당 부분을
-- 영어 강사 시트에서 연휴제외 차수별로 들어가게하려함. 하루 수업이 2시간이면 1시간씩 차수에 넣을지
-- 2시간씩 차수넣을지 선택해서 … 자동기입하도록. JJ실의 경우 자습실이라 별도임."*
--
-- 🔑 구조 결정:
--   ① 표 셋 — `textbooks`(책 한 권) · `textbook_lessons`(그 책의 차수 한 칸) ·
--      `class_textbook_plans`(그 책을 어느 반에 어떤 단위로 태울지). 차수별 진도·과제가 **행**이라야
--      "10차수 모두 작성"이 표로 서고 B2(집계용 전건 fetch 금지)에도 걸리지 않는다.
--   ② 🔴 **수납관리의 `textbook_catalog`(교재 단가표)와 합치지 않는다.** 그쪽은 makeedu와 동기화되는
--      **금액** 표(146행, `price`·`makeedu_id`)이고 교재신청·수강료 계산기 picker가 그대로 읽는다.
--      실측(2026-09-16, `class_sheet_plan_lines` 2,550행)의 교재 문자열은 **372종**이라 그걸 부으면
--      돈 화면의 picker가 통째로 오염된다. 대신 **등록 폼이 단가표에서 이름을 불러오게** 해 두 목록의
--      표기가 갈리지 않게만 한다(링크 컬럼은 소비처가 생길 때 더한다 — orphan 금지).
--   ③ 🔴 **`class_sheet_plan_lines`에 교재 FK를 심지 않는다.** 그 표는 **실제 기록**이고 자유 텍스트가
--      정본이다(내신교과서·`개별교재 / 개별진도`처럼 마스터에 없는 값이 정상으로 들어온다). 마스터는
--      그 칸을 **채워 주는 재료**일 뿐이라, 교재를 지워도 지난 시트가 "—"로 증발하지 않는다.
--   ④ 차수 단위(`pace`)와 축(`slot_axis`)은 **배정에 산다**(원장 2026-09-16 "반에 배정할 때마다 선택").
--      같은 책을 반마다 다른 속도로 태울 수 있어야 해서 교재에 고정하지 않았다.
--   ⑤ JJ(자습실)는 **자기 축**이다(`slot_axis='jj'`) — 정규 수업과 차수가 따로 흐른다. 실측: JJ 계획
--      줄 872건의 교재(인재원 SRS·PL(NTA)·Listening(NTA))가 정규(내신콘서트·그래머인사이드)와 겹치지
--      않는다. 🔴 LAB은 축이 아니다 — ECS가 언제나 제외하는 자리라 여기서도 대상이 아니다.
--
-- 🔴 부분 유니크(WHERE) 금지([[#113]]) — `textbook_lessons`는 (교재, 차수) 축으로 upsert한다.
-- 🔴 `auth_menu_access` 를 RLS 에 쓰지 말 것([[#92]]).
-- 🔴 RLS 정책끼리 서로의 표를 조회하지 않는다([[#109]]).
-- 읽기 = 테넌트 격리(select 정책) — 강사가 시트에서 교재를 고르려면 읽을 수 있어야 한다.
-- 쓰기 = 정책 없음 = 서버 액션(service_role) 전용 + 앱 게이트 둘:
--   · 교재·차수 편집 = `canWriteTenant("textbooks")`(사무실만 — 원장 2026-09-16)
--   · 반 배정·기입   = `requireEcsClassAccess(classId, { write: true })`(그 반 담당이면 담임·부담임도)
-- 🔴 게이트가 둘인 건 실수가 아니다 — 기입은 **그 반의 ECS 계획 줄을 쓰는 행위**라 ECS와 같은 문을
--    타야 한다(자리 진도를 자리 게이트가 아니라 ECS 게이트가 여는 것과 같은 결).
--
-- ⚠️ 앱은 이 SQL 적용 전에도 죽지 않는다([[#95]]) — 표가 없으면 `/textbooks`는 한글 배너 + 편집 잠금,
--    ECS 시트의 교재 제안 목록은 조용히 빈 채로 돈다(계획 줄 쓰기·읽기는 이 표를 전혀 안 본다).
--
-- 롤백:
--   drop function if exists public.ecs_apply_textbook_lessons(uuid, uuid, uuid, text, text, text, text, jsonb);
--   drop table if exists public.class_textbook_plans;
--   drop table if exists public.textbook_lessons;
--   drop table if exists public.textbooks;
set local statement_timeout = '60s';

-- ── 1. 교재 한 권 ────────────────────────────────────────────────────────────
create table if not exists public.textbooks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- classes.subject 컨벤션(math/english/…). 자동기입은 영어(ECS)만이지만 표는 과목을 처음부터 든다
  -- (0260a report_templates 선례 — 수학이 올 때 표를 다시 파지 않기 위해).
  subject text not null default 'english'
    constraint textbooks_subject_len check (char_length(btrim(subject)) between 1 and 24),
  -- 구분 = 학원설정 `operations.subjects[].skillAreas[].key`. null = 미지정(배정은 못 하고 목록엔 남는다).
  skill_area text
    constraint textbooks_skill_area_fmt check (skill_area is null or skill_area ~ '^[a-z0-9_]{1,24}$'),
  title text not null
    constraint textbooks_title_len check (char_length(btrim(title)) between 1 and 120),
  -- 페이지/시간 — 계획 줄의 `page_range`와 **같은 칸**이다(실측 채워진 1,368건 중 816건이 '35분'·'15분'
  -- 같은 시간이라 교재마다 사실상 고정값). 라벨만 둘이고 저장은 한 칸이라는 ECS 규약을 그대로 잇는다.
  page_time text constraint textbooks_page_time_len check (char_length(page_time) <= 40),
  session_count smallint not null default 0
    constraint textbooks_session_count_rng check (session_count between 0 and 200),
  -- 표지 사진 — Supabase Storage 경로(`{tenantId}/textbooks/{uuid}.ext`). 파일 자체는 버킷에 산다.
  cover_path text constraint textbooks_cover_len check (char_length(cover_path) <= 300),
  -- ⚠️ 출판사·비고·단가표 FK는 **일부러 안 뒀다** — 읽어서 동작이 바뀌는 소비처가 없는 칸은 만들지도
  --    노출하지도 않는다는 규칙(CLAUDE.md write-only-orphan). 단가표에서 이름을 불러오는 건 등록 폼의
  --    prefill이라 링크를 저장할 필요가 없다. 필요해지면 그때 컬럼을 더한다.
  is_active boolean not null default true,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.textbooks is
  '교재목록 — 수업(커리큘럼) 교재 마스터(0266a). 구분·페이지/시간·차수 수·표지. 금액은 textbook_catalog(교재 단가표)가 따로 든다.';

-- 🔴 같은 과목에 같은 이름을 두 번 만들지 못하게 — 이 기능의 존재 이유가 "372종으로 갈린 이름을 한 줄로"다.
--    대소문자·앞뒤 공백만 다른 것도 같은 책으로 본다. ⚠️ WHERE is_active를 붙이지 않는다([[#113]]):
--    비활성 동명 교재가 있으면 23505가 나고, 앱이 "이미 있습니다(비활성) — 되살리세요"로 안내한다.
create unique index if not exists textbooks_tenant_title_uniq
  on public.textbooks (tenant_id, subject, lower(btrim(title)));
create index if not exists textbooks_tenant_active_idx
  on public.textbooks (tenant_id, subject, is_active);

-- ── 2. 차수 한 칸(진도·과제) ─────────────────────────────────────────────────
create table if not exists public.textbook_lessons (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  textbook_id uuid not null
    constraint textbook_lessons_textbook_fkey references public.textbooks(id) on delete cascade,
  lesson_no smallint not null
    constraint textbook_lessons_no_rng check (lesson_no between 1 and 200),
  progress text constraint textbook_lessons_progress_len check (char_length(progress) <= 500),
  homework text constraint textbook_lessons_homework_len check (char_length(homework) <= 500),
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.textbook_lessons is
  '교재 차수 한 칸(0266a) — 그 책의 N차수에 나갈 진도·과제. 반에 배정하면 이 값이 ECS 계획 줄의 빈 칸으로 흘러간다.';

-- 일반 유니크(부분 금지 [[#113]]) — 차수 표 저장이 이 축으로 upsert한다.
create unique index if not exists textbook_lessons_pos_uniq
  on public.textbook_lessons (tenant_id, textbook_id, lesson_no);

-- ── 3. 반 배정 ──────────────────────────────────────────────────────────────
create table if not exists public.class_textbook_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  class_id uuid not null,
  textbook_id uuid not null
    constraint class_textbook_plans_textbook_fkey references public.textbooks(id) on delete cascade,
  -- 축 — 정규 수업 교시 / JJ(자습실) 교시. LAB은 ECS가 언제나 제외하는 자리라 축이 아니다.
  slot_axis text not null default 'class'
    constraint class_textbook_plans_axis_chk check (slot_axis in ('class', 'jj')),
  -- 차수 1개가 소비하는 단위 — period = 교시마다 1차수(1시간씩) / day = 하루에 1차수(그날 모든 교시에
  -- 같은 차수를 적는다, 2시간씩). 실측상 두 패턴이 다 쓰인다(같은 날 두 교시에 같은 진도 = 15%).
  pace text not null default 'period'
    constraint class_textbook_plans_pace_chk check (pace in ('period', 'day')),
  term_mode text not null default 'regular'
    constraint class_textbook_plans_term_chk check (term_mode in ('regular', 'exam')),
  start_date date not null,
  start_lesson_no smallint not null default 1
    constraint class_textbook_plans_start_no_rng check (start_lesson_no between 1 and 200),
  is_active boolean not null default true,
  last_applied_at timestamptz,
  last_applied_by uuid references public.users(id) on delete set null,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'class_textbook_plans_class_fk') then
    alter table public.class_textbook_plans
      add constraint class_textbook_plans_class_fk
      foreign key (tenant_id, class_id) references public.classes (tenant_id, id) on delete cascade;
  end if;
end $$;

comment on table public.class_textbook_plans is
  '반 교재 배정(0266a) — 어느 반의 어느 축(수업/JJ)에 이 교재를 어떤 단위(교시/하루)로 태울지. 기입은 명시 버튼일 때만 돈다(자동 쓰기 없음).';

-- 한 반의 한 축에 같은 교재를 두 번 걸지 못하게(일반 유니크).
create unique index if not exists class_textbook_plans_pos_uniq
  on public.class_textbook_plans (tenant_id, class_id, textbook_id, slot_axis);
create index if not exists class_textbook_plans_class_idx
  on public.class_textbook_plans (tenant_id, class_id, is_active);
create index if not exists class_textbook_plans_textbook_idx
  on public.class_textbook_plans (tenant_id, textbook_id);

-- ── 4. RLS — 읽기는 테넌트 전원, 쓰기는 service_role(서버 액션)만 ──────────────
alter table public.textbooks enable row level security;
alter table public.textbook_lessons enable row level security;
alter table public.class_textbook_plans enable row level security;

drop policy if exists textbooks_tenant_read on public.textbooks;
create policy textbooks_tenant_read on public.textbooks
  for select using (tenant_id = public.auth_tenant_id());

drop policy if exists textbook_lessons_tenant_read on public.textbook_lessons;
create policy textbook_lessons_tenant_read on public.textbook_lessons
  for select using (tenant_id = public.auth_tenant_id());

drop policy if exists class_textbook_plans_tenant_read on public.class_textbook_plans;
create policy class_textbook_plans_tenant_read on public.class_textbook_plans
  for select using (tenant_id = public.auth_tenant_id());

-- ── 5. updated_at — 공용 트리거 함수 재사용 ──────────────────────────────────
drop trigger if exists textbooks_set_updated_at on public.textbooks;
create trigger textbooks_set_updated_at before update on public.textbooks
  for each row execute function public.tg_set_updated_at();

drop trigger if exists textbook_lessons_set_updated_at on public.textbook_lessons;
create trigger textbook_lessons_set_updated_at before update on public.textbook_lessons
  for each row execute function public.tg_set_updated_at();

drop trigger if exists class_textbook_plans_set_updated_at on public.class_textbook_plans;
create trigger class_textbook_plans_set_updated_at before update on public.class_textbook_plans
  for each row execute function public.tg_set_updated_at();

-- ── 6. RPC: 차수 → ECS 계획 줄 기입 (빈 칸만) ────────────────────────────────
--
-- 🔑 **어디에 무엇을 넣을지는 앱이 정한다.** 날짜·교시 배분(휴일 제외·축·단위)은 순수 함수
--    [`buildLessonSchedule`](src/features/textbooks/lesson-schedule.ts)가 Vitest 아래에서 계산하고,
--    여기 SQL은 그 결과(`p_targets`)를 **원자적으로 쓰기만** 한다. 배분 규칙을 SQL에도 적으면 두 곳이
--    갈려 화면의 미리보기와 실제 기입이 달라진다(#0152a가 상태 라벨을 SQL에 복제하지 않은 것과 같은 결).
--
-- 🔴 **덮어쓰기 없음** — `ecs_copy_slot`(0209a/0245a)과 같은 규약이라 잘못 눌러도 잃을 게 없고,
--    같은 배정을 다시 눌러도 안전하다(멱등에 가깝다: 이미 채운 칸은 건드리지 않는다).
--
-- 줄 고르기 순서(한 교시 안에서):
--   ① 같은 교재명이 이미 적힌 줄 → 그 줄의 빈 칸만 채운다(차수가 바뀌면 진도가 이어 붙는 게 아니라
--      **빈 칸일 때만** 들어간다 — 사람이 적어 둔 진도를 밀어내지 않는다).
--   ② 없으면 같은 구분의 **완전히 빈 줄**(ecs_is_meaningful_line = false) → 그 줄을 쓴다.
--   ③ 없으면 새 줄(line_no = max+1, 20줄 상한. 넘치면 truncated로 정직하게 알린다).
create or replace function public.ecs_apply_textbook_lessons(
  p_tenant uuid, p_actor uuid, p_class uuid,
  p_term_mode text, p_skill_area text, p_title text, p_page_time text,
  p_targets jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_t jsonb;
  v_date date;
  v_slot time;
  v_progress text;
  v_homework text;
  v_line_id uuid;
  v_next smallint;
  v_filled int := 0;
  v_added int := 0;
  v_skipped int := 0;
  v_truncated int := 0;
  v_touched int;
begin
  if p_term_mode not in ('regular', 'exam') then
    raise exception 'ECS_BAD_TERM';
  end if;
  if p_skill_area is null or p_skill_area !~ '^[a-z0-9_]{1,24}$' then
    raise exception 'ECS_BAD_SKILL_AREA';
  end if;
  if nullif(btrim(coalesce(p_title, '')), '') is null then
    raise exception 'ECS_BAD_TITLE';
  end if;
  -- ⚠️ `jsonb_typeof(null)`은 null이라 `null <> 'array'`도 null이다 — coalesce가 없으면 이 가드가
  --    읽히는 대로 동작하지 않는다(그냥 통과한다).
  if jsonb_typeof(coalesce(p_targets, '[]'::jsonb)) <> 'array' then
    raise exception 'ECS_BAD_TARGETS';
  end if;
  -- 🔴 상한이 **락 예산**이다. 아래 루프가 대상 칸마다 `ecs_slot_lock`(xact advisory)을 잡고 그 락은
  --    커밋까지 안 풀린다 — 한 호출이 1000칸이면 클러스터 공용 락 테이블
  --    (`max_locks_per_transaction × (max_connections + …)`, 작은 인스턴스 ≈ 3,840)의 25%를 혼자 쓴다.
  --    동시에 두 번 돌면 **무관한 요청까지** `out of shared memory`로 떨어뜨릴 수 있다.
  -- 🔑 300은 실무 최대의 5배 이상이다 — 교재는 10~30차수이고 하루 비자리 교시는 1~4개라
  --    가장 큰 현실 조합(30차수 × 4교시 = 120칸)도 넉넉히 들어온다. 넘으면 앱이 한글로 안내한다.
  -- 🔴 락을 (반) 단위 하나로 바꾸지 말 것 — `ecs_create_plan_line`·`ecs_copy_slot`이 (반,날짜,교시)로
  --    잡아서, 키가 다르면 서로를 못 막고 `line_no` 경쟁이 DEFERRABLE 유니크 위반으로 터진다.
  if jsonb_array_length(coalesce(p_targets, '[]'::jsonb)) > 300 then
    raise exception 'ECS_TOO_MANY_TARGETS';
  end if;

  -- ⚠️ **락은 대상마다 하나**(`ecs_slot_lock` = xact advisory)라 한 호출이 잡는 락 수 = 대상 칸 수다.
  --    실무 규모는 수십 칸(10~30차수 × 교시)이고, 상한(1000)에 닿아도 Postgres 전역 락 슬롯 안에 있다.
  --    🔑 앱이 targets를 **날짜·교시 오름차순**으로 만들어 넘기므로 동시 호출도 같은 순서로 잡는다(교착 회피).
  --    🔴 락을 (반) 단위 하나로 줄이지 말 것 — `ecs_create_plan_line`·`ecs_copy_slot`이 (반,날짜,교시)로
  --       잡아서, 키가 다르면 서로를 못 막고 `line_no` 경쟁이 DEFERRABLE 유니크 위반으로 터진다.
  for v_t in select t.value from jsonb_array_elements(coalesce(p_targets, '[]'::jsonb)) as t(value)
  loop
    v_date := (v_t ->> 'date')::date;
    v_slot := (v_t ->> 'slot')::time;
    v_progress := nullif(btrim(coalesce(v_t ->> 'progress', '')), '');
    v_homework := nullif(btrim(coalesce(v_t ->> 'homework', '')), '');

    perform ecs_slot_lock(p_tenant, p_class, v_date, v_slot);

    -- ① 같은 교재명 + **같은 구분**인 줄.
    -- 🔴 구분은 **선호가 아니라 필터**다. 실측상 372종 중 28종이 둘 이상의 구분에서 쓰인다
    --    (`인재원 SRS` = vocab·writing·listening). 구분이 달라도 통과시키면 **writing 계획이 vocab 줄에**
    --    적히고(그 줄의 skill_area는 그대로라) 정작 writing 줄은 영영 안 생긴다. 다르면 ②·③으로 간다.
    select id into v_line_id
    from class_sheet_plan_lines
    where tenant_id = p_tenant and class_id = p_class
      and plan_date = v_date and slot_start = v_slot and term_mode = p_term_mode
      and skill_area = p_skill_area
      and lower(btrim(coalesce(textbook, ''))) = lower(btrim(p_title))
    order by line_no
    limit 1;

    -- ② 같은 구분의 완전히 빈 줄
    if v_line_id is null then
      select id into v_line_id
      from class_sheet_plan_lines
      where tenant_id = p_tenant and class_id = p_class
        and plan_date = v_date and slot_start = v_slot and term_mode = p_term_mode
        and skill_area = p_skill_area
        and not ecs_is_meaningful_line(textbook, page_range, progress, homework)
      order by line_no
      limit 1;
    end if;

    if v_line_id is not null then
      -- 빈 칸만 채운다. 실제로 채울 게 있는 줄만 UPDATE해 updated_at·'수정중' 신호가 헛돌지 않게 한다.
      update class_sheet_plan_lines l
      -- 🔴 원문을 **그대로 둔다**(`ecs_copy_slot` 0245a와 같은 모양) — `coalesce(btrim(old), new)`로 쓰면
      --    비어 있지 않은 칸의 앞뒤 공백이 조용히 잘린다. "안 건드린다"고 해 놓고 건드리는 셈이다.
      set textbook = case when nullif(btrim(coalesce(l.textbook, '')), '') is null then btrim(p_title) else l.textbook end,
          page_range = case when nullif(btrim(coalesce(l.page_range, '')), '') is null
                            then nullif(btrim(coalesce(p_page_time, '')), '') else l.page_range end,
          progress = case when nullif(btrim(coalesce(l.progress, '')), '') is null then v_progress else l.progress end,
          homework = case when nullif(btrim(coalesce(l.homework, '')), '') is null then v_homework else l.homework end,
          updated_by = p_actor,
          updated_at = now()
      where l.id = v_line_id
        and (
          (nullif(btrim(coalesce(l.textbook, '')), '') is null)
          or (nullif(btrim(coalesce(l.page_range, '')), '') is null and nullif(btrim(coalesce(p_page_time, '')), '') is not null)
          or (nullif(btrim(coalesce(l.progress, '')), '') is null and v_progress is not null)
          or (nullif(btrim(coalesce(l.homework, '')), '') is null and v_homework is not null)
        );
      get diagnostics v_touched = row_count;
      if v_touched > 0 then
        v_filled := v_filled + v_touched;
      else
        v_skipped := v_skipped + 1;
      end if;
    else
      -- ③ 새 줄. pos_uq가 DEFERRABLE이라 ON CONFLICT를 못 쓴다 → 락 아래에서 max+1.
      select coalesce(max(line_no), 0) + 1 into v_next
      from class_sheet_plan_lines
      where tenant_id = p_tenant and class_id = p_class
        and plan_date = v_date and slot_start = v_slot and term_mode = p_term_mode;

      if v_next > 20 then
        v_truncated := v_truncated + 1;
      else
        insert into class_sheet_plan_lines
          (tenant_id, class_id, plan_date, slot_start, term_mode, skill_area, line_no,
           textbook, page_range, progress, homework, updated_by)
        select p_tenant, p_class, v_date, v_slot, p_term_mode, p_skill_area, v_next,
               btrim(p_title), nullif(btrim(coalesce(p_page_time, '')), ''), v_progress, v_homework, p_actor
        where not exists (
          select 1 from class_sheet_plan_lines
          where tenant_id = p_tenant and class_id = p_class
            and plan_date = v_date and slot_start = v_slot
            and term_mode = p_term_mode and line_no = v_next
        );
        get diagnostics v_touched = row_count;
        v_added := v_added + v_touched;
      end if;
    end if;

    v_line_id := null;
  end loop;

  return jsonb_build_object(
    'applied', v_filled + v_added,
    'filled', v_filled,
    'added', v_added,
    -- 이미 다 적혀 있어 손대지 않은 칸 — 0이 아니라는 게 정상이다(덮어쓰기를 안 하니까).
    'skipped', v_skipped,
    -- 20줄 상한에 걸려 못 넣은 칸. 조용히 버리면 "기입했는데 한 줄이 없다"가 된다.
    'truncated', v_truncated
  );
end;
$fn$;

revoke all on function public.ecs_apply_textbook_lessons(uuid, uuid, uuid, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.ecs_apply_textbook_lessons(uuid, uuid, uuid, text, text, text, text, jsonb) to service_role;

comment on function public.ecs_apply_textbook_lessons(uuid, uuid, uuid, text, text, text, text, jsonb) is
  '교재 차수 → ECS 계획 줄 기입(0266a). 날짜·교시 배분은 앱(buildLessonSchedule)이 정하고 여기서는 원자적으로 쓰기만 한다. 줄 고르기 = 같은 교재명 → 같은 구분의 빈 줄 → 새 줄(≤20). **빈 칸만 채운다**(덮어쓰기 없음, ecs_copy_slot과 같은 규약). execute=service_role만.';

notify pgrst, 'reload schema';
