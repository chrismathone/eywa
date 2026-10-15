-- Preserve the exact installed RPC bodies/signatures while changing only entry authorization
-- and execution identity. The NOLOGIN owner inherits authenticated and cannot bypass RLS.
grant usage,create on schema public to student_status_lifecycle;
do $$
declare f record; definition text; body text;
begin
  for f in select p.oid,p.proname,p.prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in
      ('move_enrollments_batch','move_class_enrollments_batch','change_scheduled_enrollment','rollback_enrollment_import')
  loop
    definition:=pg_get_functiondef(f.oid);
    body:=regexp_replace(f.prosrc, '\mbegin\M', E'begin\n  perform student_status_private.require_lifecycle(''classes'');', 'i');
    if f.proname='move_enrollments_batch' then
      -- The old invoker body did not validate the target FK's tenant or source period.
      body:=replace(body, 'if v_transferred then',
        E'if not exists(select 1 from public.classes where id=v_new_class and tenant_id=v_tenant and is_active) then raise exception ''이동할 반을 찾을 수 없습니다''; end if;\n      if exists(select 1 from public.enrollments where id=v_enr_id and (start_date>v_eff or (end_date is not null and end_date<v_eff))) then raise exception ''이동일이 수강 기간과 맞지 않습니다''; end if;\n      if v_transferred then');
    end if;
    if f.proname='rollback_enrollment_import' then
      body:=replace(body, 'perform student_status_private.require_lifecycle(''classes'');',
        E'perform student_status_private.require_lifecycle(''classes'');\n  if exists(select 1 from public.timetable_snapshots where id=p_snapshot_id and tenant_id=public.auth_tenant_id() and jsonb_array_length(coalesce(payload->''removes'',''[]''::jsonb))>0) and not student_status_private.allowed() then raise exception ''원생 상태 변경 권한이 없습니다''; end if;\n  if exists(select 1 from public.timetable_snapshots s cross join lateral jsonb_array_elements(coalesce(s.payload->''moves'',''[]''::jsonb)) m join public.enrollments e on e.id=(m->>''enrollmentId'')::uuid and e.tenant_id=s.tenant_id where s.id=p_snapshot_id and s.tenant_id=public.auth_tenant_id() and e.is_transferred and (e.end_date<=(now() at time zone ''Asia/Seoul'')::date or not exists(select 1 from public.enrollments n where n.tenant_id=e.tenant_id and n.student_id=e.student_id and n.is_transferred_in and n.start_date=e.end_date and (n.id=(m->>''newEnrollmentId'')::uuid or ((m->>''newEnrollmentId'') is null and n.class_id=(m->>''toClassId'')::uuid and n.start_date=s.reference_date))))) then raise exception ''반 이동 예약이 변경되었습니다. 새로고침해 주세요''; end if;');
    end if;
    if position('student_status_private.require_lifecycle' in f.prosrc)=0 then
      execute replace(definition,f.prosrc,body);
    end if;
    execute format('alter function %s security definer',f.oid::regprocedure);
    execute format('alter function %s set row_security=on',f.oid::regprocedure);
    execute format('alter function %s owner to student_status_lifecycle',f.oid::regprocedure);
    execute format('revoke all on function %s from public,anon',f.oid::regprocedure);
    execute format('grant execute on function %s to authenticated,service_role',f.oid::regprocedure);
  end loop;
end $$;
revoke create on schema public from student_status_lifecycle;

-- Reopening a class is separate from directly restoring an individual enrollment.
create or replace function public.reopen_class_enrollments(p_class uuid,p_reason text)
returns table(student_id uuid) language plpgsql security definer set search_path=public set row_security=on as $$
declare c public.classes%rowtype;
begin
  perform student_status_private.require_lifecycle('classes');
  select * into c from public.classes where id=p_class and tenant_id=public.auth_tenant_id() for update;
  if not found or p_reason not in ('종강','반 폐지') or
    (p_reason='종강' and c.closed_at is not null) or (p_reason='반 폐지' and not c.is_active) then
    raise exception '수업 운영 상태가 변경되었습니다. 새로고침해 주세요'; end if;
  return query update public.enrollments e set end_date=null,withdrawal_reason=null
    where e.class_id=c.id and e.tenant_id=c.tenant_id and e.withdrawal_reason=p_reason and e.end_date is not null
    returning e.student_id;
end $$;
grant create on schema public to student_status_lifecycle;
alter function public.reopen_class_enrollments(uuid,text) owner to student_status_lifecycle;
revoke create on schema public from student_status_lifecycle;
revoke all on function public.reopen_class_enrollments(uuid,text) from public,anon;
grant execute on function public.reopen_class_enrollments(uuid,text) to authenticated,service_role;

-- Old clients must not erase an explicit revocation or expand legacy authority via menu saves.
create or replace function student_status_private.guard_settings() returns trigger
language plpgsql security invoker set search_path=public as $$
declare before_special jsonb:=old.data->'permissions'->'specialAccess';
  after_special jsonb:=new.data->'permissions'->'specialAccess'; k text;
begin
  if current_user<>'authenticated' then return new; end if;
  if coalesce(before_special ? 'studentStatusManagerIds',false) and
    not coalesce(after_special ? 'studentStatusManagerIds',false) then
    raise exception '원생 상태 변경 권한은 새 설정 화면에서 저장해 주세요';
  end if;
  if not coalesce(before_special ? 'studentStatusManagerIds',false) and
    not coalesce(after_special ? 'studentStatusManagerIds',false) then
    foreach k in array array['overrides','userOverrides'] loop
      if (select coalesce(jsonb_agg(v order by v::text),'[]') from jsonb_array_elements(coalesce(old.data->'permissions'->k,'[]')) v where v->>'menu'='students')
        is distinct from (select coalesce(jsonb_agg(v order by v::text),'[]') from jsonb_array_elements(coalesce(new.data->'permissions'->k,'[]')) v where v->>'menu'='students') then
        raise exception '원생 메뉴 권한을 바꾸기 전에 원생 상태 변경 담당자를 지정해 주세요';
      end if;
    end loop;
  end if;
  return new;
end $$;
revoke all on function student_status_private.guard_settings() from public,anon;
drop trigger if exists zz_student_status_settings on public.tenant_settings;
create trigger zz_student_status_settings before update on public.tenant_settings
  for each row execute function student_status_private.guard_settings();
notify pgrst,'reload schema';
