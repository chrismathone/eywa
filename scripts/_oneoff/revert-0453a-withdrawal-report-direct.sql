-- 되돌리기 — 0453a 퇴원보고서 '관리자 바로 처리'. 🔴 적용 SQL이 아니다(되돌릴 때만 운영자가 따로 실행).
-- 바로 처리 기록(direct = true)이 하나라도 있으면 멈춘다 — 기록을 지우지 않는다(퇴원 처리의 근거다). 그 경우는 원장과 먼저 정한다.
-- 순서: 바로 처리 함수 삭제 → 전이 함수 글자 두 곳을 원래대로 → CHECK 원래대로 → 칸 삭제.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists(select 1 from public.withdrawal_reports where direct) then
    raise exception 'revert-0453a: 바로 처리 기록이 있어 되돌리지 않습니다 — 기록을 먼저 확인해 주세요';
  end if;
end $$;

drop function if exists public.direct_withdrawal_report(uuid, uuid, jsonb);

do $$
declare
  fn constant text := 'public.transition_withdrawal_report(uuid,uuid,uuid,text,jsonb)';
  definition text;
  old_apply constant text := 'if p_actor is not null or g.status<>''scheduled'' or g.effective_date>today then raise exception ''처리일이 된 승인 보고서만 처리할 수 있습니다.''; end if;';
  new_apply constant text := 'if (p_actor is not null and not (r.direct and p_actor=g.requested_by)) or g.status<>''scheduled'' or g.effective_date>today then raise exception ''처리일이 된 승인 보고서만 처리할 수 있습니다.''; end if;';
  old_empty constant text := 'if coalesce(cardinality(targets),0)=0 then raise exception ''종료할 수강을 찾을 수 없습니다.''; end if;';
  new_empty constant text := 'if coalesce(cardinality(targets),0)=0 and not (r.direct and g.exit_kind=''withdrawal'') then raise exception ''종료할 수강을 찾을 수 없습니다.''; end if;';
begin
  select pg_get_functiondef(fn::regprocedure) into definition;
  definition := replace(replace(definition, new_apply, old_apply), new_empty, old_empty);
  if position(new_apply in definition) > 0 or position(new_empty in definition) > 0 then
    raise exception 'revert-0453a: 전이 함수를 원래대로 돌리지 못했습니다';
  end if;
  execute definition;
end $$;
revoke all on function public.transition_withdrawal_report(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.transition_withdrawal_report(uuid, uuid, uuid, text, jsonb) to service_role;

alter table public.withdrawal_reports drop constraint if exists withdrawal_reports_check;
alter table public.withdrawal_reports add constraint withdrawal_reports_check check (teacher_id <> manager_id and teacher_id <> director_id and manager_id <> director_id);
alter table public.withdrawal_reports drop constraint if exists withdrawal_reports_subjects_check;
alter table public.withdrawal_reports add constraint withdrawal_reports_subjects_check check (cardinality(subjects) > 0);
alter table public.withdrawal_reports drop column if exists direct;

notify pgrst, 'reload schema';

commit;
