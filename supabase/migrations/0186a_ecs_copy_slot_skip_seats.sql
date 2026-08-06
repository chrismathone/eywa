-- 0186a — `ecs_copy_slot`이 **자리(LAB·JJ) 교시에서 복사하지 않게** (0183a 후속, 적대 리뷰 2026-08-06)
--
-- 0183a는 "같은 시기에서 앞선 것 중 가장 최근 교시"를 원본으로 골랐는데 **자리 필터가 없었다.**
-- ECS는 LAB을 항상 안 그리고 JJ도 설정에 따라 숨긴다([`grid.ts`](src/features/class-sheets/lib/grid.ts)
-- `hiddenSeatOf`) — 그래서 원본이 자리 교시로 잡히면 *"08-05 16:00 교시에서 3줄 복사"* 라는 토스트가
-- 화면 어디에도 없는 시각을 가리키고, 내용도 다른 방(자율·랩) 것이 들어온다.
--
-- 🔴 판정은 **표시 설정과 무관하게** 자리면 전부 제외한다. 토글(JJ 표시)에 따라 복사 결과가 달라지면
--    같은 버튼이 사람마다 다른 계획을 만들어 낸다 — 보기 설정이 데이터를 바꾸면 안 된다.
-- ⚠️ 라벨 별칭은 앱(`specialSlotLabel`)과 **같은 집합**이어야 한다: LAB·이주희·랩실·lab실 / JJ·집중자율수업실·자율실.
--    앱 쪽에 별칭을 추가하면 여기도 함께 고칠 것(둘이 갈리면 한쪽만 자리로 세어 결과가 어긋난다).
-- 롤백 = 0183a 본문으로 이 함수를 재생성.
set local statement_timeout = '60s';

create or replace function public.ecs_copy_slot(
  p_tenant uuid, p_actor uuid, p_class uuid,
  p_plan_date date, p_slot_start time, p_term_mode text
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_src record;
  v_copied int := 0;
begin
  if p_term_mode not in ('regular', 'exam') then
    raise exception 'ECS_BAD_TERM';
  end if;

  perform ecs_slot_lock(p_tenant, p_class, p_plan_date, p_slot_start);

  -- 대상에 이미 쓴 게 있으면 손대지 않는다(주 복사와 같은 규칙 — 덮어쓰기 없음).
  if exists (
    select 1 from class_sheet_plan_lines
    where tenant_id = p_tenant and class_id = p_class
      and plan_date = p_plan_date and slot_start = p_slot_start and term_mode = p_term_mode
      and ecs_is_meaningful_line(textbook, page_range, progress, homework)
  ) then
    return jsonb_build_object('copied', 0, 'reason', 'target_not_empty');
  end if;

  -- 직전(가장 최근 앞선) 교시 — 같은 시기, 의미 있는 행 보유, 56일 이내, **자리 교시 제외**.
  select l.plan_date, l.slot_start into v_src
  from class_sheet_plan_lines l
  where l.tenant_id = p_tenant and l.class_id = p_class
    and l.term_mode = p_term_mode
    and l.plan_date between p_plan_date - 56 and p_plan_date
    and (l.plan_date, l.slot_start) < (p_plan_date, p_slot_start)
    and ecs_is_meaningful_line(l.textbook, l.page_range, l.progress, l.homework)
    -- 그 날짜에 유효한 배치가 자리(LAB·JJ)면 원본으로 쓰지 않는다. 배치가 아예 없는 고아 슬롯은
    -- 자리가 아니므로 통과시킨다(화면엔 '시간 변경됨'으로 그려져 사람이 볼 수 있다).
    and not exists (
      select 1 from class_schedules s
      where s.tenant_id = l.tenant_id and s.class_id = l.class_id
        and s.day_of_week = (array['mon','tue','wed','thu','fri','sat','sun'])[extract(isodow from l.plan_date)]::day_of_week
        and s.start_time = l.slot_start
        and s.valid_from <= l.plan_date
        and (s.valid_to is null or s.valid_to >= l.plan_date)
        and lower(btrim(coalesce(s.slot_teacher_label, ''))) in
            ('lab', 'lab실', '이주희', '랩실', 'jj', '집중자율수업실', '자율실')
    )
  order by l.plan_date desc, l.slot_start desc
  limit 1;

  if v_src.plan_date is null then
    return jsonb_build_object('copied', 0, 'reason', 'no_source');
  end if;

  -- placeholder-only 대상 행은 지우고 새로 번호를 매긴다(line_no 충돌 방지 — 주 복사와 동일).
  delete from class_sheet_plan_lines
  where tenant_id = p_tenant and class_id = p_class
    and plan_date = p_plan_date and slot_start = p_slot_start and term_mode = p_term_mode;

  insert into class_sheet_plan_lines
    (tenant_id, class_id, plan_date, slot_start, term_mode, skill_area, line_no,
     textbook, page_range, progress, homework, updated_by)
  select p_tenant, p_class, p_plan_date, p_slot_start, s.term_mode, s.skill_area,
         (row_number() over (order by s.line_no, s.created_at))::smallint,
         s.textbook, s.page_range, s.progress, s.homework, p_actor
  from class_sheet_plan_lines s
  where s.tenant_id = p_tenant and s.class_id = p_class
    and s.plan_date = v_src.plan_date and s.slot_start = v_src.slot_start
    and s.term_mode = p_term_mode
    and ecs_is_meaningful_line(s.textbook, s.page_range, s.progress, s.homework);
  get diagnostics v_copied = row_count;

  return jsonb_build_object(
    'copied', v_copied,
    'sourceDate', v_src.plan_date::text,
    'sourceSlot', to_char(v_src.slot_start, 'HH24:MI'),
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
  'ECS 직전 교시 복사(교시 단위). 같은 시기의 가장 최근 앞선 교시(56일 내, 자리 LAB·JJ 제외)에서 계획 행만 복사. 대상에 의미 행 있으면 no-op, placeholder는 재번호. execute=service_role만.';

notify pgrst, 'reload schema';
