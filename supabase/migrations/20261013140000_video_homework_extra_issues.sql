-- 보고서 없이 따로 낸 영상 숙제 + 미배정 영상 알림 묶기 (원장 2026-10-13).
--
-- ① 따로 낸 숙제: 영상 제출 현황의 '숙제없음' 칸을 우클릭해 그 날짜의 영상 숙제를 뒤늦게 낸다.
--    · 수업보고서(lesson_reports)는 건드리지 않는다 — 그날 보고서가 아예 없는 학생도 낼 수 있어야 하고, 보고서가 다시 나가지도 않는다.
--    · 숙제 = 보고서의 영상 과제 있음 ∪ 이 표. 읽는 쪽(앱 · 아래 함수)이 둘을 합친다. 단위는 그대로 반 × 학생 × 숙제일 하나.
--    · teacher_id = 누구의 숙제인가(강사 화면의 '내가 낸 숙제' · 제출/미제출 알림을 받는 사람). issued_by = 실제로 누른 계정.
-- ② 알림 묶기(원장 2026-10-13 *"알람 20개가 한번에 가면 너무 머리아프니까 한번에 뭉쳐서 몇건이 있는지만"*) — 받는 사람마다 한 줄.
--    · 미배정 영상: "미배정 영상 N건" — N = 그 사람에게 알린 적 있는 영상 중 지금도 미배정인 것(최근 14일).
--    · 미제출로 바뀜: "영상 숙제 미제출 N건" — 읽지 않은 줄이 있으면 그 줄의 N에 더한다(읽었으면 새 줄).
--    · 알리는 조건(언제 · 누구에게)은 그대로다. 읽지 않은 줄을 고치면 맨 위로 올리되, 화면 가운데 팝업은 같은 줄로 다시 뜨지 않는다.
--    · 제출 알림은 하나씩 그대로 둔다(학생이 낼 때마다 따로 온다).
--
-- 적용 순서: 이 파일이 앱 배포보다 먼저여도 된다 — 표가 비어 있으면 세 함수의 판정은 종전과 같다(알림 모양만 바뀐다).
-- 되돌리기는 이 파일에 적지 않는다.
begin;
-- 외래키가 학생·반 표에 잠금을 건다 — 긴 쓰기 거래 뒤에 줄 서서 그동안 쓰기를 막지 않게 오래 기다리지 않는다.
set local lock_timeout = '5s';

create table if not exists public.video_homework_extra_issues (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  class_id uuid not null,
  student_id uuid not null,
  homework_date date not null,
  teacher_id uuid,
  issued_by uuid,
  issued_at timestamptz not null default now(),
  primary key (tenant_id, class_id, student_id, homework_date),
  foreign key (tenant_id, class_id) references public.classes(tenant_id, id) on delete cascade,
  foreign key (tenant_id, student_id) references public.students(tenant_id, id) on delete cascade
);
create index if not exists video_homework_extra_issues_student on public.video_homework_extra_issues (tenant_id, student_id, homework_date);
create index if not exists video_homework_extra_issues_teacher on public.video_homework_extra_issues (tenant_id, teacher_id, homework_date);
alter table public.video_homework_extra_issues enable row level security;
revoke all on public.video_homework_extra_issues from public, anon, authenticated;
grant all on public.video_homework_extra_issues to service_role;
comment on table public.video_homework_extra_issues is
  '보고서 없이 따로 낸 영상 숙제(반 × 학생 × 숙제일). 서버 전용 — 영상 숙제 = 보고서의 영상 과제 있음 ∪ 이 표.';

-- 따로 낸 숙제 취소 — 영상이 붙었거나 손으로 찍은 기록이 있으면 거절한다. 자동 판정과 같은 잠금을 잡는다.
-- 돌려주는 값: cancelled(숙제가 사라졌다) · kept(따로 낸 표시만 지웠다 — 그날 보고서에도 영상 과제가 있어 숙제는 그대로) · 거절 셋.
create or replace function public.cancel_video_homework_extra_issue(p_tenant uuid,p_class uuid,p_student uuid,p_date date)
returns text language plpgsql security invoker set search_path=public,pg_temp as $$
declare reported boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||':'||p_student::text,0));
  perform 1 from public.video_homework_extra_issues where tenant_id=p_tenant and class_id=p_class and student_id=p_student and homework_date=p_date for update;
  if not found then return 'missing'; end if;
  -- 같은 날 보고서에도 영상 과제가 켜져 있으면 숙제는 그대로다 — 따로 낸 표시만 지운다.
  reported := exists(select 1 from public.lesson_reports where tenant_id=p_tenant and class_id=p_class and student_id=p_student
    and report_date=p_date and video_homework=true);
  if not reported then
    if exists(select 1 from public.video_homework_marks where tenant_id=p_tenant and class_id=p_class and student_id=p_student
      and homework_date=p_date and updated_by is not null) then return 'marked'; end if;
    if exists(select 1 from public.video_homework_auto_outcomes where tenant_id=p_tenant and class_id=p_class and student_id=p_student
        and homework_date=p_date and status='submitted')
      or exists(select 1 from public.homework_video_assignments a join public.student_homework_videos v on v.id=a.video_id and v.tenant_id=p_tenant
        where a.tenant_id=p_tenant and a.class_id=p_class and a.homework_date=p_date and v.student_id=p_student)
      or exists(select 1 from public.student_homework_videos where tenant_id=p_tenant and student_id=p_student
        and route->>'classId'=p_class::text and route->>'homeworkDate'=p_date::text) then return 'has_video'; end if;
    delete from public.video_homework_marks where tenant_id=p_tenant and class_id=p_class and student_id=p_student
      and homework_date=p_date and updated_by is null;
    delete from public.video_homework_auto_outcomes where tenant_id=p_tenant and class_id=p_class and student_id=p_student and homework_date=p_date;
  end if;
  delete from public.video_homework_extra_issues where tenant_id=p_tenant and class_id=p_class and student_id=p_student and homework_date=p_date;
  return case when reported then 'kept' else 'cancelled' end;
end $$;
revoke all on function public.cancel_video_homework_extra_issue(uuid,uuid,uuid,date) from public,anon,authenticated;
grant execute on function public.cancel_video_homework_extra_issue(uuid,uuid,uuid,date) to service_role;

-- 자동 판정: 숙제가 보고서에 없으면 따로 낸 숙제를 본다(알림 받는 사람 = 그 숙제의 선생님). 나머지는 20261012110000 그대로.
create or replace function public.reconcile_video_homework_outcomes(p_tenant uuid,p_outcomes jsonb,p_observed_at timestamptz)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  item record; old_state public.video_homework_auto_outcomes%rowtype; author uuid;
  video public.homework_video_ledger_videos%rowtype; recipient uuid; student_name text; class_name text;
  started timestamptz; today date := (now() at time zone 'Asia/Seoul')::date; slot date;
  changed integer; updated_count integer := 0; alert_count integer := 0; event_id uuid;
  previous_manual text; previous_status text; version integer; alert boolean; submitted date;
  missing_by jsonb := '{}'; missing_from jsonb := '{}'; missing_key text; note_id uuid; note_title text; note_count integer;
  old_from text; link_from date;
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
    author := null;
    select created_by into author from public.lesson_reports where tenant_id=p_tenant and class_id=item."classId"
      and student_id=item."studentId" and report_date=item."homeworkDate" and video_homework=true limit 1;
    if not found then
      select teacher_id into author from public.video_homework_extra_issues where tenant_id=p_tenant and class_id=item."classId"
        and student_id=item."studentId" and homework_date=item."homeworkDate";
      if not found then continue; end if;
    end if;
    -- A worker/upload/manual mapping changed after the server snapshot: retry on the next sweep.
    perform id from public.student_homework_videos where tenant_id=p_tenant and student_id=item."studentId" for update;
    if exists(select 1 from public.student_homework_videos where tenant_id=p_tenant and student_id=item."studentId"
      and greatest(created_at,uploaded_at,updated_at)>p_observed_at)
      or exists(select 1 from public.homework_video_assignments a join public.student_homework_videos v on v.id=a.video_id
        where a.tenant_id=p_tenant and v.student_id=item."studentId" and a.updated_at>p_observed_at)
      or exists(select 1 from public.lesson_reports where tenant_id=p_tenant and student_id=item."studentId" and created_at>p_observed_at)
      or exists(select 1 from public.video_homework_extra_issues where tenant_id=p_tenant and student_id=item."studentId" and issued_at>p_observed_at) then continue; end if;
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
      -- 숙제 없이 올린 영상(올리기 사이트 · 메모)은 선생님이 손으로 배정하기 전에는 어느 숙제의 제출도 아니다.
      if coalesce(video.route->>'free','false')='true' and coalesce(video.route->>'manualAssignment','false')<>'true' then continue; end if;
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
    select id into recipient from public.users where tenant_id=p_tenant and id=author and status='active' and system_role<>'student';
    select c.class_name,coalesce(recipient,u.id) into class_name,recipient from public.classes c left join public.users u
      on u.id=c.teacher_id and u.tenant_id=p_tenant and u.status='active' and u.system_role<>'student' where c.tenant_id=p_tenant and c.id=item."classId";
    if recipient is null then continue; end if;
    event_id:=null;
    insert into public.notification_events(tenant_id,event_type,subject_key,bucket)
      values(p_tenant,'video_homework_'||item.status,item."classId"::text||':'||item."studentId"::text||':'||item."homeworkDate"::text,version::text)
      on conflict(tenant_id,event_type,subject_key,bucket) do nothing returning id into event_id;
    if event_id is not null and item.status='missing' then
      -- 미제출은 받는 사람마다 모았다가 끝에 한 줄로(아래).
      missing_by:=jsonb_set(missing_by,array[recipient::text],to_jsonb(coalesce((missing_by->>recipient::text)::integer,0)+1));
      -- 링크 기간은 묶음에서 가장 이른 숙제일부터(오래된 숙제가 기간 밖으로 빠지지 않게).
      missing_from:=jsonb_set(missing_from,array[recipient::text],
        to_jsonb(least(coalesce((missing_from->>recipient::text)::date,item."homeworkDate"),item."homeworkDate")::text));
    elsif event_id is not null then
      insert into public.notifications(tenant_id,recipient_id,type,title,body,link)
        values(p_tenant,recipient,'video_homework_'||item.status,student_name||' 학생의 영상 숙제가 제출됐습니다',
          class_name||' · '||item."homeworkDate"::text||' 숙제 · '||submitted::text||' 제출',
          '/onescreen/video-homework?from='||item."homeworkDate"::text||'&to='||today::text);
      alert_count:=alert_count+1;
    end if;
  end loop;
  for missing_key in select k from jsonb_object_keys(missing_by) as k order by k loop
    recipient:=missing_key::uuid;
    -- 같은 사람의 묶음 줄을 두 거래가 동시에 만들지 않게.
    perform pg_advisory_xact_lock(hashtextextended('video_homework_alert:'||p_tenant::text||':'||missing_key,0));
    note_id:=null; note_count:=0; old_from:=null;
    select id,coalesce(substring(title from '^영상 숙제 미제출 ([0-9]+)건')::integer,0),substring(link from 'from=([0-9]{4}-[0-9]{2}-[0-9]{2})')
      into note_id,note_count,old_from from public.notifications
      where tenant_id=p_tenant and recipient_id=recipient and type='video_homework_missing' and read_at is null and archived_at is null
        and title ~ '^영상 숙제 미제출 [0-9]+건' order by created_at desc limit 1 for update;
    note_count:=coalesce(note_count,0)+(missing_by->>missing_key)::integer;
    note_title:='영상 숙제 미제출 '||note_count::text||'건';
    -- 고치는 줄이면 그 줄에 이미 담긴 숙제도 계속 보이게 두 기간 중 이른 쪽.
    link_from:=least((missing_from->>missing_key)::date,old_from::date);
    if note_id is not null then
      update public.notifications set title=note_title,created_at=now(),
        link='/onescreen/video-homework?from='||link_from::text||'&to='||today::text||'&status=missing' where id=note_id;
    else
      insert into public.notifications(tenant_id,recipient_id,type,title,body,link)
        values(p_tenant,recipient,'video_homework_missing',note_title,'제출 기한(숙제일 + 7일)이 지난 영상 숙제입니다. 영상 제출 현황에서 확인해 주세요.',
          '/onescreen/video-homework?from='||link_from::text||'&to='||today::text||'&status=missing');
    end if;
    alert_count:=alert_count+1;
  end loop;
  return jsonb_build_object('updated',updated_count,'notifications',alert_count);
end $$;
revoke all on function public.reconcile_video_homework_outcomes(uuid,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.reconcile_video_homework_outcomes(uuid,jsonb,timestamptz) to service_role;

-- 영상 손 배정: 따로 낸 숙제의 날짜에도 배정할 수 있다. 나머지는 20261012110000 그대로.
create or replace function public.set_homework_video_assignment(
  p_tenant uuid,p_actor uuid,p_full boolean,p_student uuid,p_context_class uuid,p_video uuid,p_date date,p_excluded boolean,p_revision integer,p_reason text
) returns text language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_video public.student_homework_videos%rowtype; v_old public.homework_video_assignments%rowtype; v_before jsonb; v_next jsonb; v_teacher uuid;
begin
  if p_excluded is null or p_full is null or p_revision is null or p_revision<0 or p_reason is null or length(trim(p_reason)) not between 1 and 300 then return 'invalid'; end if;
  if not exists(select 1 from public.users where id=p_actor and tenant_id=p_tenant and status='active') then return 'denied'; end if;
  select teacher_id into v_teacher from public.classes where id=p_context_class and tenant_id=p_tenant;
  if not found or (not p_full and v_teacher is distinct from p_actor) then return 'denied'; end if;
  if not exists(select 1 from public.lesson_reports where tenant_id=p_tenant and student_id=p_student and class_id=p_context_class and video_homework=true)
    and not exists(select 1 from public.video_homework_extra_issues where tenant_id=p_tenant and student_id=p_student and class_id=p_context_class) then return 'denied'; end if;
  select * into v_video from public.student_homework_videos where tenant_id=p_tenant and id=p_video and student_id=p_student for update;
  if not found or v_video.status is distinct from 'uploaded' or v_video.drive_file_id is null then return 'unavailable'; end if;
  select * into v_old from public.homework_video_assignments where video_id=p_video and tenant_id=p_tenant for update;
  if coalesce(v_old.revision,0)<>p_revision then return 'conflict'; end if;
  v_before := case when v_old.video_id is not null then jsonb_build_object('classId',v_old.class_id,'homeworkDate',v_old.homework_date,'excluded',v_old.excluded,'revision',v_old.revision)
    else jsonb_build_object('classId',v_video.route->>'classId','homeworkDate',v_video.route->>'homeworkDate','excluded',false,'revision',0) end;
  -- Exclusion affects the original class. A teacher may exclude only their own class's video.
  if p_excluded and not p_full and v_before->>'classId' is distinct from p_context_class::text then return 'denied'; end if;
  if not p_excluded then
    if p_date is null or p_date>(now() at time zone 'Asia/Seoul')::date or (not exists(select 1 from public.lesson_reports
      where tenant_id=p_tenant and student_id=p_student and class_id=p_context_class and report_date=p_date and video_homework=true)
      and not exists(select 1 from public.video_homework_extra_issues
        where tenant_id=p_tenant and student_id=p_student and class_id=p_context_class and homework_date=p_date)) then return 'invalid_homework'; end if;
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

-- 미배정 영상 알림: 받는 사람마다 한 줄. 돌려주는 값 = 이번에 올리거나 고친 알림 줄 수.
create or replace function public.notify_unassigned_homework_videos(p_tenant uuid,p_videos uuid[],p_observed_at timestamptz)
returns integer language plpgsql security invoker set search_path=public,pg_temp as $$
declare video record; recipient uuid; event_id uuid; count_sent integer:=0; today date:=(now() at time zone 'Asia/Seoul')::date;
  fresh uuid[]:='{}'; pending integer; note_id uuid; note_title text; note_link text;
begin
  if p_observed_at is null or p_observed_at<clock_timestamp()-interval '15 minutes' or p_observed_at>clock_timestamp()+interval '1 minute' or cardinality(p_videos)>100 then
    raise exception '영상 상태 확인 요청을 다시 실행해 주세요.'; end if;
  for video in select v.*,s.name,raw.teacher_id,raw.updated_at from public.homework_video_ledger_videos v
    join public.student_homework_videos raw on raw.id=v.id and raw.tenant_id=p_tenant
    join public.students s on s.id=v.student_id and s.tenant_id=p_tenant and not s.is_test
    where v.tenant_id=p_tenant and v.id=any(p_videos) and v.status='uploaded' and v.drive_file_id is not null
      and coalesce(v.route->>'manualAssignment','false')<>'true' and coalesce(v.route->>'excluded','false')<>'true'
      and (v.posted_at at time zone 'Asia/Seoul')::date<today
      and (v.posted_at at time zone 'Asia/Seoul')::date>=today-14
    order by v.student_id,v.id
  loop
    perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||':'||video.student_id::text,0));
    perform id from public.student_homework_videos where tenant_id=p_tenant and id=video.id for update;
    if exists(select 1 from public.student_homework_videos where tenant_id=p_tenant and student_id=video.student_id and updated_at>p_observed_at)
      or exists(select 1 from public.lesson_reports where tenant_id=p_tenant and student_id=video.student_id and created_at>p_observed_at)
      or exists(select 1 from public.video_homework_extra_issues where tenant_id=p_tenant and student_id=video.student_id and issued_at>p_observed_at)
      or exists(select 1 from public.homework_video_assignments where tenant_id=p_tenant and video_id=video.id)
      or exists(select 1 from public.video_homework_auto_outcomes o
        where o.tenant_id=p_tenant and o.video_id=video.id and o.status='submitted' and (
          exists(select 1 from public.lesson_reports r where r.tenant_id=o.tenant_id and r.class_id=o.class_id and r.student_id=o.student_id
            and r.report_date=o.homework_date and r.video_homework=true)
          or exists(select 1 from public.video_homework_extra_issues x where x.tenant_id=o.tenant_id and x.class_id=o.class_id
            and x.student_id=o.student_id and x.homework_date=o.homework_date))) then continue; end if;
    for recipient in select distinct u.id from public.users u where u.tenant_id=p_tenant and u.status='active' and u.system_role<>'student' and (
      u.id=video.teacher_id or exists(select 1 from public.classes c where c.tenant_id=p_tenant and c.teacher_id=u.id and c.id::text=video.route->>'classId')
      or (video.teacher_id is null and video.route->>'classId' is null and exists(
        select 1 from public.enrollments e join public.classes c on c.id=e.class_id and c.tenant_id=p_tenant
        where e.tenant_id=p_tenant and e.student_id=video.student_id and c.teacher_id=u.id and c.is_active
          and (video.subject is null or c.subject=video.subject) and (e.start_date is null or e.start_date<=today) and (e.end_date is null or e.end_date>=today))))
    loop
      event_id:=null;
      insert into public.notification_events(tenant_id,event_type,subject_key,bucket)
        values(p_tenant,'video_homework_unassigned',video.id::text,recipient::text)
        on conflict(tenant_id,event_type,subject_key,bucket) do nothing returning id into event_id;
      if event_id is not null and not (recipient=any(fresh)) then fresh:=array_append(fresh,recipient); end if;
    end loop;
  end loop;
  note_link:='/onescreen/video-homework?from='||(today-14)::text||'&to='||today::text;
  -- 받는 사람 잠금은 늘 같은 순서로(자동 판정 함수와 같은 순서 — 서로 기다리다 멈추지 않게).
  foreach recipient in array coalesce((select array_agg(x order by x::text) from unnest(fresh) x),'{}') loop
    -- 같은 사람의 묶음 줄을 두 거래가 동시에 만들지 않게.
    perform pg_advisory_xact_lock(hashtextextended('video_homework_alert:'||p_tenant::text||':'||recipient::text,0));
    -- 그 사람에게 알린 적 있는 영상 중 지금도 미배정인 것(최근 14일). 🔴 '미배정' 판정은 위 알림 조건과 같은 식이다 —
    -- 다르면 알림은 소모됐는데 건수가 0이라 그 영상을 영영 알리지 않는다(적대적 리뷰 2026-10-13).
    -- 이벤트를 먼저 거른 뒤에 uuid로 바꾼다 — 같은 표의 다른 이벤트 키(반:학생:날짜)가 캐스트에 닿지 않게(실행 계획과 무관하게).
    with ev as materialized (
      select e.subject_key::uuid as video_id from public.notification_events e
      where e.tenant_id=p_tenant and e.event_type='video_homework_unassigned' and e.bucket=recipient::text
        and e.created_at>=now()-interval '20 days')
    select count(*) into pending from ev
      join public.homework_video_ledger_videos v on v.tenant_id=p_tenant and v.id=ev.video_id
      where v.status='uploaded' and v.drive_file_id is not null
        and coalesce(v.route->>'manualAssignment','false')<>'true' and coalesce(v.route->>'excluded','false')<>'true'
        and (v.posted_at at time zone 'Asia/Seoul')::date>=today-14
        and not exists(select 1 from public.homework_video_assignments a where a.tenant_id=p_tenant and a.video_id=v.id)
        and not exists(select 1 from public.video_homework_auto_outcomes o
          where o.tenant_id=p_tenant and o.video_id=v.id and o.status='submitted' and (
            exists(select 1 from public.lesson_reports r where r.tenant_id=o.tenant_id and r.class_id=o.class_id and r.student_id=o.student_id
              and r.report_date=o.homework_date and r.video_homework=true)
            or exists(select 1 from public.video_homework_extra_issues x where x.tenant_id=o.tenant_id and x.class_id=o.class_id
              and x.student_id=o.student_id and x.homework_date=o.homework_date)));
    if pending<1 then continue; end if;
    note_title:='미배정 영상 '||pending::text||'건이 있습니다';
    note_id:=null;
    select id into note_id from public.notifications where tenant_id=p_tenant and recipient_id=recipient
      and type='video_homework_unassigned' and read_at is null and archived_at is null order by created_at desc limit 1 for update;
    if note_id is not null then
      update public.notifications set title=note_title,body='영상 제출 현황에서 숙제를 연결해 주세요.',link=note_link,created_at=now() where id=note_id;
    else
      insert into public.notifications(tenant_id,recipient_id,type,title,body,link)
        values(p_tenant,recipient,'video_homework_unassigned',note_title,'영상 제출 현황에서 숙제를 연결해 주세요.',note_link);
    end if;
    count_sent:=count_sent+1;
  end loop;
  return count_sent;
end $$;
revoke all on function public.notify_unassigned_homework_videos(uuid,uuid[],timestamptz) from public,anon,authenticated;
grant execute on function public.notify_unassigned_homework_videos(uuid,uuid[],timestamptz) to service_role;
commit;
notify pgrst,'reload schema';
