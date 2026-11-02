-- s2_0014 되돌리기 — 학생당 진행 중 묶음 하나로 되돌린다.
-- 같은 학생에 진행 중인 묶음이 둘 이상이면 멈춘다(먼저 하나를 마무리하거나 취소할 것).
begin;
do $$
declare
  definition text;
  o text;
  busy text := ' then raise exception ''같은 과목의 퇴원보고서가 진행 중입니다. 그 보고서를 먼저 마무리해 주세요.''; end if;';
  overlap text := 'exists(select 1 from public.withdrawal_report_groups g2 where g2.tenant_id=p_tenant and g2.student_id=s.id and g2.status not in (''completed'',''canceled'') and (g2.exit_kind=''withdrawal'' or g2.subjects && chosen or cardinality(chosen)=0))';
begin
  if exists(select 1 from public.withdrawal_report_groups where status not in ('completed','canceled') group by tenant_id, student_id having count(*) > 1) then
    raise exception '진행 중인 묶음이 둘 이상인 학생이 있어 되돌릴 수 없습니다';
  end if;

  select pg_get_functiondef('public.request_withdrawal_report_group(uuid,uuid,jsonb)'::regprocedure) into definition;
  o := ' if ' || overlap || busy;
  if position(o in definition) = 0 then raise exception '되돌릴 줄이 없습니다(요청 함수)'; end if;
  execute replace(definition, o, '');

  select pg_get_functiondef('public.direct_withdrawal_report(uuid,uuid,jsonb)'::regprocedure) into definition;
  if position(o in definition) = 0 then raise exception '되돌릴 줄이 없습니다(바로 처리 과목)'; end if;
  definition := replace(definition, o, '');
  o := 'student_id = s.id and group_id is null and status not in (''completed'',''canceled''))';
  if position(o in definition) = 0 then raise exception '되돌릴 줄이 없습니다(바로 처리 보고서)'; end if;
  definition := replace(definition, o, 'student_id = s.id and status not in (''completed'',''canceled''))');
  o := E'\n    then\n';
  if position(o in definition) > 0 then
    definition := replace(definition, o, E'\n    or exists(select 1 from public.withdrawal_report_groups where tenant_id = p_tenant and student_id = s.id and status not in (''completed'',''canceled'')) then\n');
  else
    o := E'\r\n    then\r\n';
    if position(o in definition) = 0 then raise exception '되돌릴 줄이 없습니다(바로 처리 묶음)'; end if;
    definition := replace(definition, o, E'\r\n    or exists(select 1 from public.withdrawal_report_groups where tenant_id = p_tenant and student_id = s.id and status not in (''completed'',''canceled'')) then\r\n');
  end if;
  execute definition;

  select pg_get_functiondef('public.transition_withdrawal_report(uuid,uuid,uuid,text,jsonb)'::regprocedure) into definition;
  o := 'valid:=(case when g.exit_kind=''withdrawal'' then snap is not distinct from g.snapshot else public.withdrawal_report_scope(snap,g.subjects) is not distinct from public.withdrawal_report_scope(g.snapshot,g.subjects) end)';
  if position(o in definition) = 0 then raise exception '되돌릴 줄이 없습니다(처리 함수 대조)'; end if;
  definition := replace(definition, o, 'valid:=snap is not distinct from g.snapshot');
  o := 'if g.exit_kind<>''withdrawal'' and not exists(select 1 from public.enrollments e join public.classes c on c.id=e.class_id and c.tenant_id=p_tenant where e.tenant_id=p_tenant and e.student_id=g.student_id and not e.id=any(coalesce(targets,''{}''::uuid[])) and c.is_active and c.closed_at is null and (e.end_date is null or e.end_date>greatest(g.effective_date,today))) then'
    || ' g.exit_kind:=''withdrawal''; update public.withdrawal_report_groups set exit_kind=''withdrawal'' where id=g.id; update public.withdrawal_reports set exit_kind=''withdrawal'' where group_id=g.id; end if; ';
  if position(o in definition) = 0 then raise exception '되돌릴 줄이 없습니다(처리 함수 퇴원 승격)'; end if;
  execute replace(definition, o, '');

  select pg_get_functiondef('public.check_withdrawal_report_submission()'::regprocedure) into definition;
  o := 'if (case when new.exit_kind=''withdrawal'' then public.withdrawal_report_snapshot(new.tenant_id,new.student_id) is distinct from new.snapshot'
    || ' else public.withdrawal_report_scope(public.withdrawal_report_snapshot(new.tenant_id,new.student_id),coalesce((select g.subjects from public.withdrawal_report_groups g where g.id=new.group_id and g.tenant_id=new.tenant_id),new.subjects))'
    || ' is distinct from public.withdrawal_report_scope(new.snapshot,coalesce((select g.subjects from public.withdrawal_report_groups g where g.id=new.group_id and g.tenant_id=new.tenant_id),new.subjects)) end) then';
  if position(o in definition) = 0 then raise exception '되돌릴 줄이 없습니다(제출 트리거)'; end if;
  execute replace(definition, o, 'if public.withdrawal_report_snapshot(new.tenant_id,new.student_id) is distinct from new.snapshot then');
end $$;
drop index if exists public.withdrawal_report_groups_open;
create unique index withdrawal_report_groups_pending on public.withdrawal_report_groups(tenant_id, student_id) where status not in ('completed','canceled');
drop function if exists public.withdrawal_report_scope(jsonb, text[]);
notify pgrst, 'reload schema';
commit;
