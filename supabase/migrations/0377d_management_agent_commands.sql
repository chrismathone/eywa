begin;
create or replace function public.management_case_command(
  p_id uuid, p_version integer, p_command text, p_result text default null,
  p_note text default '', p_next date default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare c public.management_cases; s public.student_consultations; lvl text; actor uuid := auth.uid();
  today date := (now() at time zone 'Asia/Seoul')::date; kind text; cfg jsonb;
begin
  select * into c from public.management_cases where id = p_id and tenant_id = public.auth_tenant_id() for update;
  if not found or not exists(select 1 from public.users where id=actor and tenant_id=c.tenant_id and status='active') then
    raise exception using errcode='42501', message='이 작업을 처리할 권한이 없습니다';
  end if;
  lvl := public.auth_menu_access('consultations');
  select * into s from public.student_consultations where id=c.consultation_id and tenant_id=c.tenant_id for share;
  if coalesce(lvl,'none') not in ('full','scoped') or (lvl='scoped' and (s.id is null or s.counselor_id is distinct from actor)) then
    raise exception using errcode='42501', message='상담 처리 권한이 없습니다';
  end if;
  select data #> '{notifications,managementAgent}' into cfg from public.tenant_settings where tenant_id=c.tenant_id;
  if coalesce(cfg->>'mode','off') not in ('observe','active') then raise exception '후속조치 관리가 꺼져 있습니다'; end if;
  if c.version is distinct from p_version then raise exception '다른 변경이 있습니다. 새로고침 후 다시 확인해 주세요'; end if;
  if p_command is null or p_command not in ('acknowledge','submit','verify','dismiss','reopen') then raise exception '처리 종류를 확인해 주세요'; end if;
  if length(coalesce(p_note,'')) > 1000 or (p_command <> 'acknowledge' and length(trim(coalesce(p_note,''))) < 10) then
    raise exception '처리 내용 또는 판단 근거를 10~1000자로 적어 주세요';
  end if;
  if p_command in ('verify','dismiss','reopen') and lvl <> 'full' then
    raise exception using errcode='42501', message='관리자 확인이 필요합니다';
  end if;
  if p_command <> 'dismiss' and (s.id is null or s.student_id <> c.student_id or s.follow_up_date is null
      or s.follow_up_date <> c.source_due_on or s.counselor_id is distinct from c.source_counselor_id) then
    raise exception '상담 원본이 변경되었습니다. 최신 확인 후 다시 처리해 주세요';
  end if;
  if p_command <> 'reopen' and c.status in ('resolved','dismissed') then raise exception '종료된 건입니다. 먼저 다시 열어 주세요'; end if;
  if p_command = 'acknowledge' then
    if c.acknowledged_at is not null then raise exception '이미 접수된 건입니다'; end if;
    c.acknowledged_at := now();
    if c.status = 'open' then c.status := 'in_progress'; end if;
    kind := 'acknowledged';
  elsif p_command = 'submit' then
    if p_result is null or p_result not in ('contacted','retry','decision') then raise exception '처리 결과를 선택해 주세요'; end if;
    if p_result = 'retry' and (p_next is null or p_next < today or p_next > today + 90) then
      raise exception '다음 연락일은 오늘부터 90일 이내로 선택해 주세요';
    end if;
    c.result_kind := p_result; c.result_note := trim(p_note); c.verification_note := null;
    c.acknowledged_at := coalesce(c.acknowledged_at,now());
    c.next_check_on := case when p_result='retry' then p_next else today end;
    c.status := case when p_result='retry' then 'in_progress' else 'waiting_review' end;
    kind := 'submitted';
  elsif p_command = 'verify' then
    if c.status <> 'waiting_review' or c.result_kind is distinct from 'contacted' or not s.follow_up_done then
      raise exception '처리 결과와 상담 후속조치 완료를 먼저 확인해 주세요';
    end if;
    c.status := 'resolved'; c.verification_note := trim(p_note); kind := 'verified';
  elsif p_command = 'dismiss' then
    c.status := 'dismissed'; c.verification_note := trim(p_note); kind := 'dismissed';
  else
    if c.status not in ('resolved','dismissed') then raise exception '종료된 건만 다시 열 수 있습니다'; end if;
    c.status := 'open'; c.episode := c.episode + 1; c.acknowledged_at := null;
    c.result_kind := null; c.result_note := null; c.verification_note := null;
    c.next_check_on := today; c.last_reminded_on := null; kind := 'reopened';
  end if;
  c.version := c.version + 1;
  update public.management_cases set status=c.status, episode=c.episode, version=c.version,
    result_kind=c.result_kind, result_note=c.result_note, verification_note=c.verification_note,
    acknowledged_at=c.acknowledged_at, next_check_on=c.next_check_on, last_reminded_on=c.last_reminded_on,
    source_done=coalesce(s.follow_up_done,c.source_done), updated_at=now(), last_checked_at=now()
    where id=c.id and tenant_id=c.tenant_id;
  perform public.management_case_event(c,kind,actor,nullif(trim(p_note),''));
  return c.id;
end;
$$;
revoke all on function public.management_case_command(uuid,integer,text,text,text,date) from public, anon;
grant execute on function public.management_case_command(uuid,integer,text,text,text,date) to authenticated;
commit;
