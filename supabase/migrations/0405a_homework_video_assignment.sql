-- Manual classification is separate from worker-owned video metadata, so old workers cannot undo it.
begin;
create table if not exists public.homework_video_assignments (
  video_id uuid primary key references public.student_homework_videos(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id),
  class_id uuid references public.classes(id), homework_date date, excluded boolean not null default false,
  revision integer not null check (revision>0), updated_by uuid not null references public.users(id), updated_at timestamptz not null default now(),
  check ((excluded and class_id is null and homework_date is null) or (not excluded and class_id is not null and homework_date is not null))
);
create table if not exists public.homework_video_assignment_history (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id), video_id uuid not null references public.student_homework_videos(id) on delete cascade,
  actor_id uuid not null references public.users(id), created_at timestamptz not null default now(),
  previous_assignment jsonb not null, next_assignment jsonb not null, reason text not null check (length(reason) between 1 and 300)
);
create index if not exists homework_video_assignment_history_video on public.homework_video_assignment_history(tenant_id,video_id,created_at desc);
alter table public.homework_video_assignments enable row level security;
alter table public.homework_video_assignment_history enable row level security;
revoke all on public.homework_video_assignments,public.homework_video_assignment_history from anon,authenticated;
grant all on public.homework_video_assignments,public.homework_video_assignment_history to service_role;
grant usage on sequence public.homework_video_assignment_history_id_seq to service_role;

create or replace view public.homework_video_ledger_videos with (security_invoker=true) as
select v.id,v.tenant_id,v.student_id,case when a.class_id is not null then coalesce(c.subject,v.subject) else v.subject end subject,v.post_id,v.comment_id,v.posted_at,v.created_at,v.uploaded_at,v.md5,v.bytes,v.status,v.drive_file_id,v.source,
  case when a.video_id is null then v.route-'manualAssignment'-'excluded' else coalesce(v.route,'{}'::jsonb)||jsonb_build_object(
    'classId',a.class_id,'homeworkDate',a.homework_date,'manualAssignment',true,'excluded',a.excluded) end route,
  coalesce(a.revision,0) assignment_revision
from public.student_homework_videos v left join public.homework_video_assignments a on a.video_id=v.id and a.tenant_id=v.tenant_id
left join public.classes c on c.id=a.class_id and c.tenant_id=v.tenant_id;
revoke all on public.homework_video_ledger_videos from anon,authenticated;
grant select on public.homework_video_ledger_videos to service_role;

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
    if exists(select 1 from public.video_homework_marks where tenant_id=p_tenant and student_id=p_student and class_id=p_context_class
      and homework_date=p_date and status='missing') then return 'missing_mark'; end if;
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
commit;
notify pgrst,'reload schema';
