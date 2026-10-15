-- 영상 숙제 마감(원장 2026-10-15 *"선생님이 영상 숙제 체크할때 마감 날짜를 정하는게 좋을듯. 다음수업 또는 7일 둘중에 하나 토글하게"* · *"기본값은 7일"*).
--  · null = 7일(숙제일 + 7일, 지금까지의 규칙) · 날짜 = '다음 수업'을 고른 보고서의 다음 수업일 — 저장할 때 앱이 시간표로 찾아 날짜로 고정한다
--    (src/features/video-homework/due.ts · server/report-due.ts). 올리기 사이트가 받는 기간 · 미수행 판정 · 보고서 카드가 이 값을 본다.
--  · 앱은 이 칸이 없어도 돈다(전부 7일로 읽는다 — #95). 이 파일을 적용해야 원스크린에 마감 토글이 보인다.
--  · 따로 낸 숙제(video_homework_extra_issues)는 7일 그대로다 — 마감 칸이 없다.
alter table public.lesson_reports add column if not exists video_homework_due date;
comment on column public.lesson_reports.video_homework_due is
  '영상 숙제 제출 마감(그날 포함). null = 숙제일 + 7일. 날짜 = 원스크린에서 ''다음 수업''을 고른 보고서의 다음 수업일(저장 때 고정).';

-- 숙제일 다음 날 ~ 14일 뒤(장부가 영상을 그 숙제로 세는 창 rounds.ts VIDEO_MATCH_WINDOW_DAYS). 기존 줄은 전부 null이라 훑지 않는다(not valid — 큰 표 검사 잠금 없음).
do $$ begin
  if not exists (select 1 from pg_constraint where conname='lesson_reports_video_homework_due_range' and conrelid='public.lesson_reports'::regclass) then
    alter table public.lesson_reports add constraint lesson_reports_video_homework_due_range
      check (video_homework_due is null or (video_homework_due > report_date and video_homework_due <= report_date + 14)) not valid;
  end if;
end $$;

-- 자동 판정: 미수행·미확인을 가르는 날을 숙제일 + 7일 대신 그 숙제의 마감으로. 나머지는 20261013140000 그대로.
create or replace function public.reconcile_video_homework_outcomes(p_tenant uuid,p_outcomes jsonb,p_observed_at timestamptz)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  item record; old_state public.video_homework_auto_outcomes%rowtype; author uuid;
  video public.homework_video_ledger_videos%rowtype; recipient uuid; student_name text; class_name text;
  started timestamptz; today date := (now() at time zone 'Asia/Seoul')::date; slot date;
  changed integer; updated_count integer := 0; alert_count integer := 0; event_id uuid;
  previous_manual text; previous_status text; version integer; alert boolean; submitted date;
  missing_by jsonb := '{}'; missing_from jsonb := '{}'; missing_key text; note_id uuid; note_title text; note_count integer;
  old_from text; link_from date; due date;
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
    author := null; due := null;
    select created_by,video_homework_due into author,due from public.lesson_reports where tenant_id=p_tenant and class_id=item."classId"
      and student_id=item."studentId" and report_date=item."homeworkDate" and video_homework=true limit 1;
    if not found then
      select teacher_id into author from public.video_homework_extra_issues where tenant_id=p_tenant and class_id=item."classId"
        and student_id=item."studentId" and homework_date=item."homeworkDate";
      if not found then continue; end if;
    end if;
    -- 마감 = 보고서에 고른 '다음 수업'(숙제일 다음 날 ~ 14일 안) 또는 숙제일 + 7일(앱 due.ts `homeworkDue`와 같은 규칙).
    if due is null or due<=item."homeworkDate" or due>item."homeworkDate"+14 then due := item."homeworkDate"+7; end if;
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
    elsif item."videoId" is not null or (item.status='missing' and today<=due)
      or (item.status='unchecked' and today>due) then continue;
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
      (item.status='missing' and (due+1>=(started at time zone 'Asia/Seoul')::date or previous_manual='submitted')));
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
        values(p_tenant,recipient,'video_homework_missing',note_title,'제출 마감이 지난 영상 숙제입니다. 영상 제출 현황에서 확인해 주세요.',
          '/onescreen/video-homework?from='||link_from::text||'&to='||today::text||'&status=missing');
    end if;
    alert_count:=alert_count+1;
  end loop;
  return jsonb_build_object('updated',updated_count,'notifications',alert_count);
end $$;
revoke all on function public.reconcile_video_homework_outcomes(uuid,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.reconcile_video_homework_outcomes(uuid,jsonb,timestamptz) to service_role;

-- 마감의 주인 = 영상 과제 값과 같다(그 줄을 처음 쓴 선생님 — src/features/video-homework/report-owner.ts · due-write.ts).
-- 0336a 트리거를 넓혀 마감도 지킨다 — 앱이 못 막는 둘(두 선생님이 같은 순간 처음 저장하는 경합 · 앱을 거치지 않는 직접 갱신)에서
-- 작성 계정이 있고 내가 아닌 로그인 사용자의 갱신은 영상 과제 값과 마감을 **원래 값으로 둔다**(거절하지 않는다 — 나머지 내용은 그대로 저장).
-- 서버 관리 키(auth.uid() 없음)의 갱신과 작성 계정이 빈 줄은 0336a와 같이 대상이 아니다. 칸은 이 파일 위에서 만든다(함수가 그 칸을 읽는다).
create or replace function public.lesson_reports_keep_video_homework_owner()
returns trigger language plpgsql as $$
begin
  if old.created_by is not null
     and auth.uid() is not null
     and auth.uid() <> old.created_by then
    if new.video_homework is distinct from old.video_homework then
      new.video_homework := old.video_homework;
    end if;
    if new.video_homework_due is distinct from old.video_homework_due then
      new.video_homework_due := old.video_homework_due;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists lesson_reports_keep_video_homework_owner_trg on public.lesson_reports;
create trigger lesson_reports_keep_video_homework_owner_trg
  before update of video_homework, video_homework_due on public.lesson_reports
  for each row execute function public.lesson_reports_keep_video_homework_owner();
