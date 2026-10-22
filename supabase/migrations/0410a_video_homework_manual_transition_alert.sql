-- Re-checking an already observed outcome must still notify when a teacher check changes.
begin;
create or replace function public.reconcile_video_homework_outcomes(p_tenant uuid,p_outcomes jsonb,p_observed_at timestamptz)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  item record; old_state public.video_homework_auto_outcomes%rowtype; report public.lesson_reports%rowtype;
  video public.homework_video_ledger_videos%rowtype; recipient uuid; student_name text; class_name text;
  started timestamptz; today date := (now() at time zone 'Asia/Seoul')::date; slot date;
  changed integer; updated_count integer := 0; alert_count integer := 0; event_id uuid;
  previous_manual text; previous_status text; version integer; alert boolean; submitted date;
begin
  if p_observed_at is null or p_observed_at>clock_timestamp()+interval '1 minute'
    or p_observed_at<clock_timestamp()-interval '15 minutes' or jsonb_typeof(p_outcomes)<>'array'
    or jsonb_array_length(p_outcomes)>100 then raise exception '영상 상태 확인 요청을 다시 실행해 주세요.'; end if;
  select started_at into started from public.video_homework_automation_config where singleton;
  -- Lock in a stable order: overlapping retries must not produce two alerts or invert fresh state.
  for item in select * from jsonb_to_recordset(p_outcomes) as x("classId" uuid,"studentId" uuid,"homeworkDate" date,status text,"videoId" uuid)
    order by "studentId","classId","homeworkDate"
  loop
    if item.status not in ('submitted','missing','unchecked') or item."homeworkDate">today then continue; end if;
    perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||':'||item."studentId"::text,0));
    select name into student_name from public.students where tenant_id=p_tenant and id=item."studentId" and not is_test for update;
    if not found then continue; end if;
    select * into report from public.lesson_reports where tenant_id=p_tenant and class_id=item."classId"
      and student_id=item."studentId" and report_date=item."homeworkDate" and video_homework=true limit 1;
    if not found then continue; end if;
    -- A worker/upload/manual mapping changed after the server snapshot: retry on the next sweep.
    perform id from public.student_homework_videos where tenant_id=p_tenant and student_id=item."studentId" for update;
    if exists(select 1 from public.student_homework_videos where tenant_id=p_tenant and student_id=item."studentId"
      and greatest(created_at,uploaded_at,updated_at)>p_observed_at)
      or exists(select 1 from public.homework_video_assignments a join public.student_homework_videos v on v.id=a.video_id
        where a.tenant_id=p_tenant and v.student_id=item."studentId" and a.updated_at>p_observed_at)
      or exists(select 1 from public.lesson_reports where tenant_id=p_tenant and student_id=item."studentId" and created_at>p_observed_at) then continue; end if;
    select * into old_state from public.video_homework_auto_outcomes where tenant_id=p_tenant and class_id=item."classId"
      and student_id=item."studentId" and homework_date=item."homeworkDate" for update;
    if old_state.observed_at>p_observed_at then continue; end if;
    submitted := null;
    if item.status='submitted' then
      select * into video from public.homework_video_ledger_videos where tenant_id=p_tenant and id=item."videoId" and student_id=item."studentId"
        and status='uploaded' and drive_file_id is not null and route->>'classId'=item."classId"::text
        and coalesce(route->>'excluded','false')<>'true';
      if not found then continue; end if;
      submitted := (video.posted_at at time zone 'Asia/Seoul')::date;
      if submitted is null or submitted>today then continue; end if;
      if video.route->>'homeworkDate' is not null and video.route->>'homeworkDate'<>item."homeworkDate"::text then continue; end if;
      if coalesce(video.route->>'manualAssignment','false')<>'true'
        and (submitted<item."homeworkDate" or submitted>item."homeworkDate"+14) then continue; end if;
    elsif item."videoId" is not null or (item.status='missing' and today<=item."homeworkDate"+7)
      or (item.status='unchecked' and today>item."homeworkDate"+7) then continue;
    end if;
    select status into previous_manual from public.video_homework_marks where tenant_id=p_tenant and class_id=item."classId"
      and student_id=item."studentId" and homework_date=item."homeworkDate" and updated_by is not null order by updated_at desc limit 1;
    previous_status := old_state.status;
    version := coalesce(old_state.revision,0)+case when old_state.status is distinct from item.status or (previous_manual is not null and previous_manual is distinct from item.status) then 1 else 0 end;
    insert into public.video_homework_auto_outcomes(tenant_id,class_id,student_id,homework_date,status,video_id,revision,observed_at)
      values(p_tenant,item."classId",item."studentId",item."homeworkDate",item.status,item."videoId",version,p_observed_at)
      on conflict(tenant_id,class_id,student_id,homework_date) do update set status=excluded.status,video_id=excluded.video_id,
        revision=excluded.revision,observed_at=excluded.observed_at;
    if item.status='unchecked' then
      delete from public.video_homework_marks where tenant_id=p_tenant and class_id=item."classId" and student_id=item."studentId"
        and homework_date=item."homeworkDate" and updated_by is null and previous_status in ('submitted','missing');
      get diagnostics changed=row_count; updated_count:=updated_count+changed;
      continue;
    end if;
    update public.video_homework_marks set status=item.status,submitted_date=submitted,updated_by=null,updated_at=now()
      where tenant_id=p_tenant and class_id=item."classId" and student_id=item."studentId" and homework_date=item."homeworkDate"
      and (status is distinct from item.status or submitted_date is distinct from submitted or updated_by is not null);
    get diagnostics changed=row_count; updated_count:=updated_count+changed;
    if not exists(select 1 from public.video_homework_marks where tenant_id=p_tenant and class_id=item."classId"
      and student_id=item."studentId" and homework_date=item."homeworkDate") then
      slot:=item."homeworkDate"+1;
      loop
        insert into public.video_homework_marks(tenant_id,class_id,student_id,check_date,homework_date,status,submitted_date)
          values(p_tenant,item."classId",item."studentId",slot,item."homeworkDate",item.status,submitted)
          on conflict(tenant_id,class_id,student_id,check_date) do nothing;
        get diagnostics changed=row_count;
        exit when changed=1;
        slot:=slot+1;
      end loop;
      updated_count:=updated_count+1;
    end if;
    -- Seed historical state silently, except an existing manual completion that has now expired.
    alert := (previous_status is distinct from item.status or (previous_manual is not null and previous_manual is distinct from item.status)) and (
      previous_status is not null or
      (item.status='submitted' and greatest(video.created_at,video.uploaded_at)>=started) or
      (item.status='missing' and (item."homeworkDate"+8>=(started at time zone 'Asia/Seoul')::date or previous_manual='submitted')));
    if not alert then continue; end if;
    recipient:=null;
    select id into recipient from public.users where tenant_id=p_tenant and id=report.created_by and status='active' and system_role<>'student';
    select c.class_name,coalesce(recipient,u.id) into class_name,recipient from public.classes c left join public.users u
      on u.id=c.teacher_id and u.tenant_id=p_tenant and u.status='active' and u.system_role<>'student' where c.tenant_id=p_tenant and c.id=item."classId";
    if recipient is null then continue; end if;
    event_id:=null;
    insert into public.notification_events(tenant_id,event_type,subject_key,bucket)
      values(p_tenant,'video_homework_'||item.status,item."classId"::text||':'||item."studentId"::text||':'||item."homeworkDate"::text,version::text)
      on conflict(tenant_id,event_type,subject_key,bucket) do nothing returning id into event_id;
    if event_id is not null then
      insert into public.notifications(tenant_id,recipient_id,type,title,body,link)
        values(p_tenant,recipient,'video_homework_'||item.status,
          student_name||case when item.status='submitted' then ' 학생의 영상 숙제가 제출됐습니다' else ' 학생의 영상 숙제가 미제출로 변경됐습니다' end,
          class_name||' · '||item."homeworkDate"::text||' 숙제'||case when item.status='missing' then ' · 제출 기한이 지났습니다.' else ' · '||submitted::text||' 제출' end,
          '/onescreen/video-homework?from='||item."homeworkDate"::text||'&to='||today::text);
      alert_count:=alert_count+1;
    end if;
  end loop;
  return jsonb_build_object('updated',updated_count,'notifications',alert_count);
end $$;
revoke all on function public.reconcile_video_homework_outcomes(uuid,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.reconcile_video_homework_outcomes(uuid,jsonb,timestamptz) to service_role;

create or replace function public.set_homework_video_assignment(
  p_tenant uuid,p_actor uuid,p_full boolean,p_student uuid,p_context_class uuid,p_video uuid,p_date date,p_excluded boolean,p_revision integer,p_reason text
) returns text language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_video public.student_homework_videos%rowtype; v_old public.homework_video_assignments%rowtype; v_before jsonb; v_next jsonb; v_teacher uuid;
begin
  if p_excluded is null or p_full is null or p_revision is null or p_revision<0 or p_reason is null or length(trim(p_reason)) not between 1 and 300 then return 'invalid'; end if;
  if not exists(select 1 from public.users where id=p_actor and tenant_id=p_tenant and status='active') then return 'denied'; end if;
  select teacher_id into v_teacher from public.classes where id=p_context_class and tenant_id=p_tenant;
  if not found or (not p_full and v_teacher is distinct from p_actor) then return 'denied'; end if;
  if not exists(select 1 from public.lesson_reports where tenant_id=p_tenant and student_id=p_student and class_id=p_context_class and video_homework=true) then return 'denied'; end if;
  select * into v_video from public.student_homework_videos where tenant_id=p_tenant and id=p_video and student_id=p_student for update;
  if not found or v_video.status is distinct from 'uploaded' or v_video.drive_file_id is null then return 'unavailable'; end if;
  select * into v_old from public.homework_video_assignments where video_id=p_video and tenant_id=p_tenant for update;
  if coalesce(v_old.revision,0)<>p_revision then return 'conflict'; end if;
  v_before := case when v_old.video_id is not null then jsonb_build_object('classId',v_old.class_id,'homeworkDate',v_old.homework_date,'excluded',v_old.excluded,'revision',v_old.revision)
    else jsonb_build_object('classId',v_video.route->>'classId','homeworkDate',v_video.route->>'homeworkDate','excluded',false,'revision',0) end;
  -- Exclusion affects the original class. A teacher may exclude only their own class's video.
  if p_excluded and not p_full and v_before->>'classId' is distinct from p_context_class::text then return 'denied'; end if;
  if not p_excluded then
    if p_date is null or p_date>(now() at time zone 'Asia/Seoul')::date or not exists(select 1 from public.lesson_reports
      where tenant_id=p_tenant and student_id=p_student and class_id=p_context_class and report_date=p_date and video_homework=true) then return 'invalid_homework'; end if;
    if v_video.posted_at is null or (v_video.posted_at at time zone 'Asia/Seoul')::date not between p_date and p_date+14 then return 'invalid_homework'; end if;
  end if;
  v_next := jsonb_build_object('classId',case when p_excluded then null else p_context_class end,
    'homeworkDate',case when p_excluded then null else p_date end,'excluded',p_excluded,'revision',p_revision+1);
  insert into public.homework_video_assignments(video_id,tenant_id,class_id,homework_date,excluded,revision,updated_by,updated_at)
    values(p_video,p_tenant,case when p_excluded then null else p_context_class end,case when p_excluded then null else p_date end,p_excluded,p_revision+1,p_actor,now())
    on conflict(video_id) do update set class_id=excluded.class_id,homework_date=excluded.homework_date,excluded=excluded.excluded,
      revision=excluded.revision,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
  insert into public.homework_video_assignment_history(tenant_id,video_id,actor_id,previous_assignment,next_assignment,reason)
    values(p_tenant,p_video,p_actor,v_before,v_next,trim(p_reason));
  return 'saved';
end $$;
revoke all on function public.set_homework_video_assignment(uuid,uuid,boolean,uuid,uuid,uuid,date,boolean,integer,text) from public,anon,authenticated;
grant execute on function public.set_homework_video_assignment(uuid,uuid,boolean,uuid,uuid,uuid,date,boolean,integer,text) to service_role;
notify pgrst, 'reload schema';
commit;
