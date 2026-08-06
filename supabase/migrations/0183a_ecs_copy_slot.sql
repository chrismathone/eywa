-- 0183a — ECS '직전 교시 복사'(교시 단위)
--
-- 원장 2026-08-06: *"ecs에서 이전 교시의 ecs를 복사하는 기능 추가."*
-- 기존 복사는 **주 단위**(`ecs_copy_week`, 0157a)뿐이고 그것도 *그 주가 통째로 비었을 때만* 배너로 떴다.
-- 한 교시만 채우고 싶을 때(같은 반의 직전 수업과 진도가 이어질 때)는 쓸 수 있는 게 없었다.
--
-- 계약은 주 복사와 **같게** 맞춘다 — 두 복사가 다르게 굴면 어느 쪽이 무엇을 덮는지 아무도 못 외운다:
--  · 대상 교시(그 시기)에 **의미 있는 행이 하나라도 있으면 아무것도 안 한다**(덮어쓰기 없음).
--  · 원본도 **의미 있는 행이 있는 교시**만 — placeholder만 있는 교시는 복사할 게 없는 것으로 본다.
--  · 학생 기록(출석·상태·개인 진도)은 복사하지 않는다. 반 전체의 사실(계획)만 옮긴다.
--
-- 🔴 원본 = **(날짜, 시각) 순으로 이 교시보다 앞선 것 중 가장 최근**. 그래서 같은 날 앞 교시도, 지난
--    수업일의 그 교시도 자연히 잡힌다("직전 수업"이 사람이 기대하는 뜻이다). 같은 시기(term_mode)끼리만.
-- ⚠️ 되돌아보는 창은 **56일**로 묶는다 — 무제한이면 방학 건너 한 학기 전 진도를 끌어와 조용히 틀린 계획을
--    만든다(그리고 전건 스캔이 된다). 못 찾으면 copied=0 + reason으로 사람에게 알린다(침묵 금지).
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

  -- 직전(가장 최근 앞선) 교시 — 같은 시기, 의미 있는 행 보유, 56일 이내.
  select l.plan_date, l.slot_start into v_src
  from class_sheet_plan_lines l
  where l.tenant_id = p_tenant and l.class_id = p_class
    and l.term_mode = p_term_mode
    and l.plan_date between p_plan_date - 56 and p_plan_date
    and (l.plan_date, l.slot_start) < (p_plan_date, p_slot_start)
    and ecs_is_meaningful_line(l.textbook, l.page_range, l.progress, l.homework)
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
    -- 복사 후 그 교시의 canonical 행 — 호출부가 클라 state를 그대로 갈아끼운다(createPlanLine과 같은 계약).
    'lines', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.term_mode, t.line_no)
      from class_sheet_plan_lines t
      where t.tenant_id = p_tenant and t.class_id = p_class
        and t.plan_date = p_plan_date and t.slot_start = p_slot_start
    ), '[]'::jsonb)
  );
end;
$$;

-- 다른 ECS RPC와 같은 노출 정책 — 앱은 service_role(admin client)로만 부른다(class_sheet_*는 deny-RLS).
revoke all on function public.ecs_copy_slot(uuid, uuid, uuid, date, time, text) from public, anon, authenticated;
grant execute on function public.ecs_copy_slot(uuid, uuid, uuid, date, time, text) to service_role;

comment on function public.ecs_copy_slot(uuid, uuid, uuid, date, time, text) is
  'ECS 직전 교시 복사(교시 단위). 같은 시기의 가장 최근 앞선 교시(56일 내)에서 계획 행만 복사. 대상에 의미 행 있으면 no-op, placeholder는 재번호. execute=service_role만.';

notify pgrst, 'reload schema';
