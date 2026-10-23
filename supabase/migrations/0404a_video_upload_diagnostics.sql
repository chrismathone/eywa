-- Upload observations are separate from verified submission status. Old workers/clients remain compatible.
begin;
alter table public.homework_video_link_uploads add column if not exists client_diagnostics jsonb not null default '{}'::jsonb;
alter table public.homework_video_link_uploads add column if not exists diagnostic_notified_at timestamptz;

create or replace function public.record_homework_video_upload_event(
  p_tenant uuid, p_link uuid, p_upload uuid, p_event jsonb, p_failure_message text default null
) returns text language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_upload public.homework_video_link_uploads%rowtype;
  v_state jsonb; v_event jsonb; v_history jsonb; v_seen jsonb;
  v_seq integer; v_max integer; v_count integer; v_window timestamptz; v_now timestamptz := clock_timestamp();
  v_student uuid; v_class uuid; v_name text; v_class_name text; v_teacher uuid;
begin
  if jsonb_typeof(p_event) is distinct from 'object' or octet_length(p_event::text)>2048
    or coalesce(p_event->>'sequence','') !~ '^[0-9]{1,7}$' then return 'invalid'; end if;
  v_seq := (p_event->>'sequence')::integer;
  if v_seq<1 or v_seq>1000000 then return 'invalid'; end if;
  select * into v_upload from public.homework_video_link_uploads
    where id=p_upload and tenant_id=p_tenant and link_id=p_link and created_at>v_now-interval '2 days' for update;
  if not found then return 'invalid'; end if;
  v_state := v_upload.client_diagnostics;
  v_max := coalesce((v_state->'last'->>'sequence')::integer,0);
  if coalesce(v_state->'seen','[]'::jsonb) @> to_jsonb(array[v_seq]) or v_seq<v_max-64 then return 'ignored'; end if;
  v_window := coalesce((v_state->>'windowAt')::timestamptz,v_now);
  v_count := coalesce((v_state->>'windowCount')::integer,0);
  if v_window<v_now-interval '1 minute' then v_window:=v_now; v_count:=0; end if;
  if v_count>=30 then return 'limited'; end if;
  v_event := p_event || jsonb_build_object('receivedAt',v_now);
  select coalesce(jsonb_agg(n order by n),'[]'::jsonb) into v_seen from
    (select distinct value::integer n from jsonb_array_elements_text(coalesce(v_state->'seen','[]'::jsonb)||to_jsonb(array[v_seq])) order by n desc limit 64) s;
  v_history := coalesce(v_state->'history','[]'::jsonb);
  if p_event->>'kind'<>'progress' then
    select coalesce(jsonb_agg(e order by (e->>'sequence')::integer),'[]'::jsonb) into v_history from
      (select value e from jsonb_array_elements(v_history||jsonb_build_array(v_event)) order by (value->>'sequence')::integer desc limit 16) h;
  end if;
  v_state := v_state || jsonb_build_object('seen',v_seen,'history',v_history,'windowAt',v_window,'windowCount',v_count+1);
  if v_seq>v_max then v_state:=v_state||jsonb_build_object('last',v_event); end if;
  if p_event->>'reason' is not null and v_seq>coalesce((v_state->'lastError'->>'sequence')::integer,0) then
    v_state:=v_state||jsonb_build_object('lastError',v_event);
  end if;
  update public.homework_video_link_uploads set client_diagnostics=v_state where id=p_upload and tenant_id=p_tenant;
  -- An observed final failure may notify once, but can never mark the upload failed/completed or remove a file.
  if p_event->>'kind' in ('failed','confirm_failed','page_left') and v_upload.status<>'completed'
    and v_upload.diagnostic_notified_at is null and p_failure_message is not null then
    select l.student_id,l.class_id,s.name,c.class_name,c.teacher_id into v_student,v_class,v_name,v_class_name,v_teacher
      from public.homework_video_links l join public.students s on s.id=l.student_id and s.tenant_id=p_tenant
      join public.classes c on c.id=l.class_id and c.tenant_id=p_tenant
      where l.id=p_link and l.tenant_id=p_tenant;
    if found then
      insert into public.notifications(tenant_id,recipient_id,type,title,body,link)
        select p_tenant,u.id,'homework_video_upload_failed',v_name||' 학생 영상 업로드 확인 필요',
          v_class_name||' · '||left(p_failure_message,180)||' · 확인번호 '||left(p_upload::text,8),
          '/students/'||v_student::text||'?tab=homework-videos#video-upload-log'
        from public.users u where u.tenant_id=p_tenant and u.status='active'
          and (u.system_role in ('master','admin') or u.id=v_teacher);
      update public.homework_video_link_uploads set diagnostic_notified_at=v_now where id=p_upload and tenant_id=p_tenant;
    end if;
  end if;
  return 'stored';
end $$;
revoke all on function public.record_homework_video_upload_event(uuid,uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.record_homework_video_upload_event(uuid,uuid,uuid,jsonb,text) to service_role;
comment on column public.homework_video_link_uploads.client_diagnostics is '기기의 업로드 진행·오류 관측값. 제출 완료 판정에 사용하지 않는다. 최근 사건 16개만 보관.';
commit;
notify pgrst, 'reload schema';
