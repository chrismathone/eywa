-- s2_0004 되돌리기 — `video_upload_settle` · `open_video_upload_task` · `tg_video_upload_task`를 0379a 본문으로, 문구 함수 `video_upload_detail`을 지운다.
-- ⚠️ s2_0004 적용 뒤 새 판정으로 닫힌 할 일은 다시 열리지 않는다 · 새 문구로 바꾼 detail · 읽음으로 바꾼 알림도 그대로 둔다
--    (되돌린 뒤 새로 여는 할 일만 옛 문구). 앱 `src/features/staff-tasks/kinds.ts`의 doneRule 문구는 앱 되돌리기로 따로.
begin;

create or replace function staff_tasks_private.video_upload_settle(p_tenant uuid, p_student uuid, p_cycle text)
returns int
language plpgsql security definer set search_path = public
as $fn$
declare
  v_class uuid := nullif(split_part(p_cycle, '|', 1), '')::uuid;
  v_key text := split_part(p_cycle, '|', 2);
  v_date date := case when v_key ~ '^\d{4}-\d{2}-\d{2}$' then v_key::date end;
  v_upload uuid := case when v_key like 'u:%' then substr(v_key, 3)::uuid end;
  v_since timestamptz;
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_opened timestamptz;
begin
  if v_upload is not null then
    -- 숙제 없이 올린 시도: 그 시도가 영상을 남겼거나, 그 뒤 같은 학생·반의 숙제 없는 업로드가 영상을 남겼으면.
    select u.created_at into v_since from public.homework_video_link_uploads u where u.id = v_upload and u.tenant_id = p_tenant;
    if staff_tasks_private.video_upload_landed(p_tenant, v_upload)
       or exists (select 1 from public.homework_video_link_uploads u
                    join public.homework_video_links l on l.id = u.link_id and l.tenant_id = p_tenant
                   where u.tenant_id = p_tenant and l.student_id = p_student and l.class_id = v_class
                     and coalesce(u.route ->> 'homeworkDate', '') = '' and u.created_at >= coalesce(v_since, now())
                     and staff_tasks_private.video_upload_landed(p_tenant, u.id)) then
      return staff_tasks_private.close_task(p_tenant, 'video_upload_check', p_student, p_cycle, 'done', 'video_arrived', null);
    end if;
  elsif exists (select 1 from public.homework_video_link_uploads u
               join public.homework_video_links l on l.id = u.link_id and l.tenant_id = p_tenant
              where u.tenant_id = p_tenant and l.student_id = p_student and l.class_id = v_class
                and u.route ->> 'homeworkDate' = v_date::text
                and staff_tasks_private.video_upload_landed(p_tenant, u.id))
     or exists (select 1 from public.video_homework_marks m
              where m.tenant_id = p_tenant and m.class_id = v_class and m.student_id = p_student and m.homework_date = v_date
                and m.status = 'submitted') then
    -- 그 숙제 영상이 들어왔다(같은 학생·반·숙제일의 완료 업로드 · 또는 그 숙제 칸이 '완료').
    return staff_tasks_private.close_task(p_tenant, 'video_upload_check', p_student, p_cycle, 'done', 'video_arrived', null);
  end if;
  -- 숙제 취소 = 취소 기록이 있고 지금 그 숙제를 낸 곳(그날 보고서의 영상 과제 · 따로 낸 숙제)이 없을 때(취소 뒤 다시 낸 숙제는 산다 — cancels.ts와 같은 판정).
  if v_date is not null
     and exists (select 1 from public.video_homework_cancels c
                  where c.tenant_id = p_tenant and c.class_id = v_class and c.student_id = p_student and c.homework_date = v_date)
     and not exists (select 1 from public.lesson_reports r
                      where r.tenant_id = p_tenant and r.class_id = v_class and r.student_id = p_student and r.report_date = v_date
                        and r.video_homework = true)
     and not exists (select 1 from public.video_homework_extra_issues x
                      where x.tenant_id = p_tenant and x.class_id = v_class and x.student_id = p_student and x.homework_date = v_date) then
    return staff_tasks_private.close_task(p_tenant, 'video_upload_check', p_student, p_cycle, 'cancelled', 'homework_cancelled', null);
  end if;
  select opened_at into v_opened from public.staff_tasks
   where tenant_id = p_tenant and kind = 'video_upload_check' and subject_id = p_student and cycle = p_cycle;
  if coalesce(v_date, (v_opened at time zone 'Asia/Seoul')::date) < v_today - 14 then
    return staff_tasks_private.close_task(p_tenant, 'video_upload_check', p_student, p_cycle, 'expired', 'upload_window', null);
  end if;
  return 0;
end;
$fn$;

create or replace function staff_tasks_private.open_video_upload_task(p_upload uuid)
returns uuid
language plpgsql security definer set search_path = public
as $fn$
declare
  u record;
  v_cycle text;
  v_assignees uuid[];
  v_id uuid;
  v_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  select up.id, up.tenant_id, up.status, up.route, up.created_at, l.student_id, l.class_id, s.name as student_name, c.class_name, c.teacher_id
    into u
    from public.homework_video_link_uploads up
    join public.homework_video_links l on l.id = up.link_id and l.tenant_id = up.tenant_id
    join public.students s on s.id = l.student_id and s.tenant_id = up.tenant_id and not s.is_test
    join public.classes c on c.id = l.class_id and c.tenant_id = up.tenant_id
   where up.id = p_upload;
  if u.id is null or u.status = 'completed' or u.created_at < staff_tasks_private.kind_start('video_upload_check') then return null; end if;
  v_cycle := staff_tasks_private.video_upload_cycle(u.class_id, u.route, u.id);
  -- 이미 영상이 들어왔거나 숙제가 취소된 회차는 열지 않는다(열자마자 닫히는 할 일을 만들지 않게).
  select coalesce(
    (select array[x.id] from public.users x where x.id = u.teacher_id and x.tenant_id = u.tenant_id and x.status = 'active'),
    (select array[x.id] from public.users x where x.id::text = u.route ->> 'teacherId' and x.tenant_id = u.tenant_id and x.status = 'active'),
    staff_tasks_private.master_ids(u.tenant_id)) into v_assignees;
  v_id := staff_tasks_private.open_task(
    u.tenant_id, 'video_upload_check', u.student_id, v_cycle,
    '영상 업로드 확인',
    coalesce(u.student_name, '학생') || ' · ' || coalesce(u.class_name, '반')
      || coalesce(' · ' || to_char(nullif(u.route ->> 'homeworkDate', '')::date, 'MM-DD') || ' 숙제', '')
      || ' — 올리다 멈춘 기록이 있습니다',
    '/students/' || u.student_id::text || '?tab=homework-videos#video-upload-log',
    -- 늦음 = 다음 날이 끝날 때까지 영상이 안 들어옴
    ((v_today + 2)::timestamp at time zone 'Asia/Seoul'),
    v_assignees, null);
  if v_id is not null then
    perform staff_tasks_private.video_upload_settle(u.tenant_id, u.student_id, v_cycle);
  end if;
  return v_id;
end;
$fn$;

create or replace function staff_tasks_private.tg_video_upload_task()
returns trigger
language plpgsql security definer set search_path = public
as $fn$
declare
  v_task uuid;
  v_student uuid;
  v_class uuid;
  x record;
begin
  if NEW.diagnostic_notified_at is not null and OLD.diagnostic_notified_at is null and NEW.status <> 'completed' then
    v_task := staff_tasks_private.open_video_upload_task(NEW.id);
    if v_task is not null then
      -- 같은 거래에서 방금 넣은 진단 알림(확인번호 = 업로드 번호 앞 8자리)에 잇는다.
      update public.notifications n set task_id = v_task
       where n.tenant_id = NEW.tenant_id and n.type = 'homework_video_upload_failed' and n.task_id is null
         and n.created_at >= now() - interval '1 minute' and n.body like '%확인번호 ' || left(NEW.id::text, 8);
    end if;
  end if;
  if NEW.status = 'completed' and (OLD.status is distinct from 'completed' or OLD.video_id is distinct from NEW.video_id) then
    select l.student_id, l.class_id into v_student, v_class from public.homework_video_links l
     where l.id = NEW.link_id and l.tenant_id = NEW.tenant_id;
    for x in
      select t.cycle from public.staff_tasks t
       where t.tenant_id = NEW.tenant_id and t.kind = 'video_upload_check' and t.subject_id = v_student
         and t.status = 'open' and t.cycle like v_class::text || '|%'
    loop
      perform staff_tasks_private.video_upload_settle(NEW.tenant_id, v_student, x.cycle);
    end loop;
  end if;
  return null;
exception when others then
  return null; -- 할 일 기록이 업로드 기록을 막지 않는다(30분 맞춤이 메운다).
end;
$fn$;

drop function if exists staff_tasks_private.video_upload_detail(text, text, date, timestamptz);

revoke all on all functions in schema staff_tasks_private from public, anon, authenticated;
grant execute on all functions in schema staff_tasks_private to service_role;

commit;
