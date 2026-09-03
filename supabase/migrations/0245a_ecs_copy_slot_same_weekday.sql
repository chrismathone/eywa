-- 0245a — ECS '내용 복사' 원본을 **같은 요일**로 좁힌다 (0183a·0186a·0209a 후속)
--
-- 원장 2026-09-03: *"강사 시트에서 지난 수업 복사시에 JJ 이외의 수업에서 복사가 다른 수업을 당겨오는
-- 버그가 있는데 체크해볼것."*
--
-- 0209a가 고친 것은 **하루 안의 교시 축**이었다("4교시에서 누르면 같은 날 3교시가 원본"). 같은 함정이
-- **요일 축**에 그대로 남아 있었다 — 영어 반은 같은 교시라도 **요일마다 커리큘럼이 다르다.**
--   실측(injaewon, 최근 70일): 같은 (반, 교시) 조합 66개 중 **52개가 요일별로 구분(skill_area) 구성이
--   다르다.** 예) 중고E_중2 최상위 17:20 → 월 = reading/vocab · 목 = grammar/reading/vocab.
--   그래서 "직전 수업일"을 원본으로 삼으면 **49.4%**에서 대상 요일에 없는 구분이 섞여 들어오고,
--   그 줄은 짝이 없어 아래 ②번 절이 **새 줄로 추가**한다 = 화면에서 "다른 수업을 당겨왔다"로 보인다.
--   교재 일치율도 48.0%(직전 수업일) vs 67.8%(같은 요일 직전)로 갈린다.
--
-- → 원본을 **같은 교시 + 같은 요일**의 지난 수업일로 좁힌다. 구분 불일치 53.3% → 26.2%,
--   대상에 없는 구분이 새 줄로 섞이는 비율 49.4% → 22.4%(같은 실측).
--
-- 🔴 **폴백은 두지 않는다.** 같은 요일 원본이 없는 경우는 10.2%뿐이고(923건 중 94건), 그때 직전
--    수업일로 폴백하면 구분이 실제와 맞는 건 **38.3%**다 — 동전 던지기로 남의 수업을 당겨오느니
--    "가져올 게 없다"고 말하는 편이 낫다(채우기는 비파괴지만, 잘못 들어온 줄은 사람이 지워야 한다).
-- 🔴 **자리(LAB·JJ)는 종전 그대로**(요일 무관, 가장 최근). 원장이 짚은 범위가 "JJ 이외"이고, 실제로
--    자율실은 요일별 구조가 같다. 여기에 요일 제한을 걸면 JJ 계획이 일주일씩 낡아진다.
-- ⚠️ **시그니처 불변(6인자)** — 이 SQL이 아직 안 돌았어도 화면은 안 죽고 옛 동작(요일 무관)으로 돌
--    뿐이다([[#95]] expand/contract). 앱은 새 키 `sameDow`가 없으면 옛 안내 문구를 쓴다.
-- 롤백 = 0209a 본문으로 `ecs_copy_slot` 재생성.
set local statement_timeout = '60s';

create or replace function public.ecs_copy_slot(
  p_tenant uuid, p_actor uuid, p_class uuid,
  p_plan_date date, p_slot_start time, p_term_mode text
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_seat text;
  v_src_date date;
  v_filled int := 0;
  v_added int := 0;
  v_next smallint;
  v_unmatched int := 0;
  v_same_dow boolean;
begin
  if p_term_mode not in ('regular', 'exam') then
    raise exception 'ECS_BAD_TERM';
  end if;

  perform ecs_slot_lock(p_tenant, p_class, p_plan_date, p_slot_start);

  v_seat := ecs_seat_kind_at(p_tenant, p_class, p_plan_date, p_slot_start);
  -- 실수업이면 같은 요일로 좁힌다. 자리(LAB·JJ)는 요일 무관(위 🔴).
  v_same_dow := v_seat is null;

  -- 원본 = **같은 교시**(+ 실수업이면 **같은 요일**)의 지난 수업일 중 가장 최근
  -- (내용 있는 날, 56일 내 = 같은 요일 8회, 자리 종류 일치).
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
    and (not v_same_dow
         or extract(isodow from l.plan_date) = extract(isodow from p_plan_date))
    and ecs_is_meaningful_line(l.textbook, l.page_range, l.progress, l.homework)
    -- 자리(LAB·JJ) 내용은 **같은 종류의 자리로만** 흐른다. 실수업·고아 배치(kind null)는 통과(0209a).
    and (k.kind is null or k.kind is not distinct from v_seat)
  order by l.plan_date desc
  limit 1;

  if v_src_date is null then
    return jsonb_build_object('copied', 0, 'reason', 'no_source', 'sameDow', v_same_dow);
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
    -- ⚠️ 원문(textbook…)과 판정용 정규화값(n_…)을 **둘 다** 들고 간다(0209a 각주 그대로).
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
    -- 이번 복사가 **같은 요일만** 봤는지 — 안내 문구가 규칙과 어긋나지 않게 화면에 그대로 알린다.
    'sameDow', v_same_dow,
    'lines', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.term_mode, t.line_no)
      from class_sheet_plan_lines t
      where t.tenant_id = p_tenant and t.class_id = p_class
        and t.plan_date = p_plan_date and t.slot_start = p_slot_start
    ), '[]'::jsonb)
  );
end;
$fn$;

revoke all on function public.ecs_copy_slot(uuid, uuid, uuid, date, time, text) from public, anon, authenticated;
grant execute on function public.ecs_copy_slot(uuid, uuid, uuid, date, time, text) to service_role;

comment on function public.ecs_copy_slot(uuid, uuid, uuid, date, time, text) is
  'ECS 내용 복사. 원본 = 같은 교시(+ 실수업이면 같은 요일)의 지난 수업일(56일 내, 자리 종류 일치)에서 계획을 가져와 **빈 칸만** 채운다(덮어쓰기 없음). 자리(LAB·JJ)는 요일 무관. 짝짓기=(skill_area, 구분 내 순번), 짝 없는 원본 줄은 새 줄로 추가(≤20). 학생 기록 미복사. execute=service_role만.';

notify pgrst, 'reload schema';
