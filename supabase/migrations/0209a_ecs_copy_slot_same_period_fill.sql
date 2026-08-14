-- 0209a — ECS '내용 복사' = **같은 교시의 지난 수업**에서 **빈 칸만 채우기** (0183a·0186a 후속)
--
-- 원장 2026-08-14: *"직전 교시 복사가 뭔가 헷갈린다. 오늘 직전차시인지 전날 복사인지."* + *"평시에도 추가."*
-- 라벨만 손보려다 실제 동작 두 가지가 틀려 있는 걸 확인했다.
--
-- ① **원본이 엉뚱한 교시였다.** 0183a는 "이 교시보다 앞선 것 중 가장 최근"을 (날짜, 시각) 순으로 골랐다.
--    그런데 영어 반은 하루에 2~3교시를 **연달아** 하고 교시마다 교재가 다르다(실측 IJW 반: 3교시
--    Vocab·Grammar 중등고난도/천일문 · 4교시 Reading 수능독해 Lv2 · 5교시 Listening) → 4교시에서 누르면
--    같은 날 3교시가 원본으로 잡혀 **Reading 칸에 Vocab 내용**이 들어왔다.
--    → 원본을 **같은 교시(slot_start)의 지난 수업일**로 고정한다. 덤으로 *"이날의 첫 수업이라 직전 차시가
--    없다"* 는 헷갈림도 사라진다 — 첫 교시든 이어지는 교시든 언제나 '같은 교시의 지난 수업'이다.
--
-- ② **평시에선 눌러도 아무 일이 없었다.** 대상에 의미 있는 행이 하나라도 있으면 통째 no-op이라, 교재만
--    미리 적어 둔 평시 구획에선 무동작이었다(그래서 버튼도 빈 구획에만 띄웠고 = 평시엔 사실상 없었다).
--    → **덮어쓰기 없는 '빈 칸만 채우기'**(원장 2026-08-14 선택). 이미 쓴 칸은 **절대 안 건드린다** —
--    잘못 눌러도 잃을 게 없으니 확인창 없이 바로 눌러도 되는 버튼이 된다.
--
-- 짝짓기 = **(구분 skill_area, 그 구분 안 순번)**. 구분이 그 줄의 정체(Vocab/Grammar/Reading)라 줄 순서가
-- 달라도 같은 구분끼리 맞춰진다. 짝이 없는 원본 줄은 **뒤에 새 줄로 추가**(line_no 상한 20 — 넘치면 조용히
-- 버리지 않고 `truncated`로 돌려준다).
--
-- ⚠️ **시그니처 불변(6인자)** — 앱은 같은 RPC를 계속 부른다. 이 SQL이 아직 안 돌았어도 화면은 안 죽고
--    옛 동작(직전 교시·덮어쓰기 없음)으로 돌 뿐이다([[#95]] expand/contract).
-- ⚠️ 자리(LAB·JJ) 매칭: 0186a는 자리 교시를 원본에서 **통째 제외**했는데, 이제 원본이 같은 시각이라
--    그 규칙을 그대로 두면 **JJ 교시가 자기 지난 수업을 못 가져온다**(실측: JJ 5교시에 실제 계획이 있다).
--    → 규칙을 **"자리 내용은 자기 자리로만 흐른다"** 로 바꾼다: 원본이 자리면 대상도 **같은 종류의 자리**
--    여야 하고, 원본이 실수업(또는 배치 없는 고아)이면 그냥 통과시킨다.
--    🔑 대칭(양쪽 완전 일치)으로 잠그지 않는 이유: 배치는 행 분할로 바뀌어서(2026-08-04) 지난 날짜엔
--       그 시각 배치가 아예 없는 고아가 흔하다 — 대칭으로 잠그면 **JJ 교시에서 복사가 조용히 죽는다.**
--       채우기는 비파괴라 헛짚어도 잃을 게 없지만, 안 되는 건 사람이 못 고친다.
--    라벨 별칭 집합은 앱(`specialSlotLabel`)과 **같아야 한다** — 한쪽에 별칭을 더하면 여기도 함께.
-- 롤백 = 0186a 본문으로 `ecs_copy_slot` 재생성(`ecs_seat_kind_at`은 남겨도 무해).
set local statement_timeout = '60s';

-- ── 자리(LAB·JJ) 종류 판정 — (반, 날짜, 시각)에 유효한 배치 1개를 골라 'lab'/'jj'/null ─────────────
-- 🔑 같은 시각에 자리와 강사 수업이 겹치면 **수업이 이긴다**(grid.ts와 같은 규약 — 자리로 뽑히면 실수업이
--    화면·집계에서 사라진다). 그래서 비자리(0)를 먼저 정렬한다.
create or replace function public.ecs_seat_kind_at(
  p_tenant uuid, p_class uuid, p_date date, p_slot time
) returns text
language sql
stable
set search_path = public
as $$
  select case
           when lower(btrim(coalesce(s.slot_teacher_label, ''))) in ('lab', 'lab실', '이주희', '랩실') then 'lab'
           when lower(btrim(coalesce(s.slot_teacher_label, ''))) in ('jj', '집중자율수업실', '자율실') then 'jj'
         end
  from class_schedules s
  where s.tenant_id = p_tenant and s.class_id = p_class
    and s.day_of_week = (array['mon','tue','wed','thu','fri','sat','sun'])[extract(isodow from p_date)]::day_of_week
    and s.start_time = p_slot
    and s.valid_from <= p_date
    and (s.valid_to is null or s.valid_to >= p_date)
  order by
    (case
       when lower(btrim(coalesce(s.slot_teacher_label, ''))) in
            ('lab', 'lab실', '이주희', '랩실', 'jj', '집중자율수업실', '자율실') then 1
       else 0
     end),
    s.valid_from desc
  limit 1
$$;

revoke all on function public.ecs_seat_kind_at(uuid, uuid, date, time) from public, anon, authenticated;
grant execute on function public.ecs_seat_kind_at(uuid, uuid, date, time) to service_role;

comment on function public.ecs_seat_kind_at(uuid, uuid, date, time) is
  'ECS 자리 판정: 그 (반,날짜,시각) 배치가 LAB이면 lab, JJ면 jj, 실수업이면 null. 겹치면 수업이 이긴다(grid.ts 규약).';

-- ── 내용 복사(같은 교시의 지난 수업 → 빈 칸만) ────────────────────────────────────────────────
create or replace function public.ecs_copy_slot(
  p_tenant uuid, p_actor uuid, p_class uuid,
  p_plan_date date, p_slot_start time, p_term_mode text
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_seat text;
  v_src_date date;
  v_filled int := 0;
  v_added int := 0;
  v_next smallint;
  v_unmatched int := 0;
begin
  if p_term_mode not in ('regular', 'exam') then
    raise exception 'ECS_BAD_TERM';
  end if;

  perform ecs_slot_lock(p_tenant, p_class, p_plan_date, p_slot_start);

  v_seat := ecs_seat_kind_at(p_tenant, p_class, p_plan_date, p_slot_start);

  -- 원본 = **같은 교시**의 지난 수업일 중 가장 최근(내용 있는 날, 56일 내, 자리 종류 일치).
  -- ⚠️ 같은 날은 후보가 아니다(plan_date < p_plan_date) — 같은 교시니까 애초에 하루 한 번뿐이다.
  select l.plan_date into v_src_date
  from class_sheet_plan_lines l
  cross join lateral (
    select ecs_seat_kind_at(p_tenant, p_class, l.plan_date, l.slot_start) as kind
  ) k
  where l.tenant_id = p_tenant and l.class_id = p_class
    and l.slot_start = p_slot_start
    and l.term_mode = p_term_mode
    and l.plan_date >= p_plan_date - 56
    and l.plan_date < p_plan_date
    and ecs_is_meaningful_line(l.textbook, l.page_range, l.progress, l.homework)
    -- 자리(LAB·JJ) 내용은 **같은 종류의 자리로만** 흐른다. 실수업·고아 배치(kind null)는 통과(위 🔑).
    and (k.kind is null or k.kind is not distinct from v_seat)
  order by l.plan_date desc
  limit 1;

  if v_src_date is null then
    return jsonb_build_object('copied', 0, 'reason', 'no_source');
  end if;

  -- ① 짝이 있는 줄: **비어 있는 칸만** 채운다(이미 쓴 칸은 그대로 — 덮어쓰기 없음).
  with src as (
    select skill_area, line_no,
           nullif(btrim(coalesce(textbook, '')), '')   as textbook,
           nullif(btrim(coalesce(page_range, '')), '') as page_range,
           nullif(btrim(coalesce(progress, '')), '')   as progress,
           nullif(btrim(coalesce(homework, '')), '')   as homework,
           row_number() over (partition by skill_area order by line_no, created_at) as rk
    from class_sheet_plan_lines
    where tenant_id = p_tenant and class_id = p_class
      and plan_date = v_src_date and slot_start = p_slot_start and term_mode = p_term_mode
      and ecs_is_meaningful_line(textbook, page_range, progress, homework)
  ),
  tgt as (
    -- ⚠️ 원문(textbook…)과 판정용 정규화값(n_…)을 **둘 다** 들고 간다. 채워진 칸은 원문 그대로 다시 써야
    --    한다 — 정규화값을 쓰면 공백만 다듬어도 "안 건드린다"는 약속이 깨지고 남의 CAS가 헛돈다.
    select id, skill_area, textbook, page_range, progress, homework,
           nullif(btrim(coalesce(textbook, '')), '')   as n_textbook,
           nullif(btrim(coalesce(page_range, '')), '') as n_page_range,
           nullif(btrim(coalesce(progress, '')), '')   as n_progress,
           nullif(btrim(coalesce(homework, '')), '')   as n_homework,
           row_number() over (partition by skill_area order by line_no, created_at) as rk
    from class_sheet_plan_lines
    where tenant_id = p_tenant and class_id = p_class
      and plan_date = p_plan_date and slot_start = p_slot_start and term_mode = p_term_mode
  ),
  pair as (
    select t.id,
           case when t.n_textbook   is null then s.textbook   else t.textbook   end as textbook,
           case when t.n_page_range is null then s.page_range else t.page_range end as page_range,
           case when t.n_progress   is null then s.progress   else t.progress   end as progress,
           case when t.n_homework   is null then s.homework   else t.homework   end as homework
    from tgt t
    join src s on s.skill_area = t.skill_area and s.rk = t.rk
    -- 실제로 채울 칸이 있는 줄만 건드린다(안 그러면 updated_at·CAS가 헛돌고 '수정중' 신호까지 튄다)
    where (t.n_textbook is null and s.textbook is not null)
       or (t.n_page_range is null and s.page_range is not null)
       or (t.n_progress is null and s.progress is not null)
       or (t.n_homework is null and s.homework is not null)
  )
  update class_sheet_plan_lines l
  set textbook = p.textbook, page_range = p.page_range,
      progress = p.progress, homework = p.homework,
      updated_by = p_actor, updated_at = now()
  from pair p
  where l.id = p.id;
  get diagnostics v_filled = row_count;

  -- ② 짝이 없는 원본 줄: 뒤에 새 줄로 추가. line_no는 **term_mode 안에서** 유일해야 한다(pos_uq).
  --    ⚠️ pos_uq는 DEFERRABLE이라 ON CONFLICT를 못 쓴다 → 락 아래에서 max+1부터 새로 번호를 매긴다.
  select coalesce(max(line_no), 0) + 1 into v_next
  from class_sheet_plan_lines
  where tenant_id = p_tenant and class_id = p_class
    and plan_date = p_plan_date and slot_start = p_slot_start and term_mode = p_term_mode;

  -- 짝 없는 원본 줄 수 — insert 전에 세어 둔다(20줄 상한에 걸려 못 넣은 줄을 정확히 알려주려고).
  with src as (
    select skill_area,
           row_number() over (partition by skill_area order by line_no, created_at) as rk
    from class_sheet_plan_lines
    where tenant_id = p_tenant and class_id = p_class
      and plan_date = v_src_date and slot_start = p_slot_start and term_mode = p_term_mode
      and ecs_is_meaningful_line(textbook, page_range, progress, homework)
  ),
  tgt as (
    select skill_area,
           row_number() over (partition by skill_area order by line_no, created_at) as rk
    from class_sheet_plan_lines
    where tenant_id = p_tenant and class_id = p_class
      and plan_date = p_plan_date and slot_start = p_slot_start and term_mode = p_term_mode
  )
  select count(*)::int into v_unmatched
  from src s
  where not exists (select 1 from tgt t where t.skill_area = s.skill_area and t.rk = s.rk);

  with src as (
    select skill_area, line_no, created_at,
           nullif(btrim(coalesce(textbook, '')), '')   as textbook,
           nullif(btrim(coalesce(page_range, '')), '') as page_range,
           nullif(btrim(coalesce(progress, '')), '')   as progress,
           nullif(btrim(coalesce(homework, '')), '')   as homework,
           row_number() over (partition by skill_area order by line_no, created_at) as rk
    from class_sheet_plan_lines
    where tenant_id = p_tenant and class_id = p_class
      and plan_date = v_src_date and slot_start = p_slot_start and term_mode = p_term_mode
      and ecs_is_meaningful_line(textbook, page_range, progress, homework)
  ),
  tgt as (
    select skill_area,
           row_number() over (partition by skill_area order by line_no, created_at) as rk
    from class_sheet_plan_lines
    where tenant_id = p_tenant and class_id = p_class
      and plan_date = p_plan_date and slot_start = p_slot_start and term_mode = p_term_mode
  ),
  extra as (
    select s.*, row_number() over (order by s.line_no, s.created_at) as seq
    from src s
    where not exists (select 1 from tgt t where t.skill_area = s.skill_area and t.rk = s.rk)
  )
  insert into class_sheet_plan_lines
    (tenant_id, class_id, plan_date, slot_start, term_mode, skill_area, line_no,
     textbook, page_range, progress, homework, updated_by)
  select p_tenant, p_class, p_plan_date, p_slot_start, p_term_mode, e.skill_area,
         (v_next + e.seq - 1)::smallint, e.textbook, e.page_range, e.progress, e.homework, p_actor
  from extra e
  where v_next + e.seq - 1 <= 20;
  get diagnostics v_added = row_count;

  return jsonb_build_object(
    'copied', v_filled + v_added,
    'filled', v_filled,
    'added', v_added,
    -- 20줄 상한에 걸려 못 넣은 원본 줄 — 조용히 버리면 "복사했는데 한 줄이 없다"가 된다.
    'truncated', greatest(0, v_unmatched - v_added),
    'reason', case when v_filled + v_added = 0 then 'target_already_filled' else null end,
    'sourceDate', v_src_date::text,
    'sourceSlot', to_char(p_slot_start, 'HH24:MI'),
    'lines', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.term_mode, t.line_no)
      from class_sheet_plan_lines t
      where t.tenant_id = p_tenant and t.class_id = p_class
        and t.plan_date = p_plan_date and t.slot_start = p_slot_start
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.ecs_copy_slot(uuid, uuid, uuid, date, time, text) from public, anon, authenticated;
grant execute on function public.ecs_copy_slot(uuid, uuid, uuid, date, time, text) to service_role;

comment on function public.ecs_copy_slot(uuid, uuid, uuid, date, time, text) is
  'ECS 내용 복사. 같은 교시(slot_start)의 지난 수업일(56일 내, 자리 종류 일치)에서 계획을 가져와 **빈 칸만** 채운다(덮어쓰기 없음). 짝짓기=(skill_area, 구분 내 순번), 짝 없는 원본 줄은 새 줄로 추가(≤20). 학생 기록 미복사. execute=service_role만.';

notify pgrst, 'reload schema';
