-- 0379a — 업무 처리 확인 4단계 b(0378a 위에): 종류 셋 — 영상 업로드 확인 · 미배정 영상 · 미발송 보고서.
--
--   video_upload_check  올리기 사이트(`/v`)에서 영상을 올리다 실패·중단한 기록이 남음 → 그 숙제 영상이 실제로 들어오면 처리됨
--                       (같은 학생·반·숙제일의 완료 업로드 또는 영상 제출 현황 '완료'). 숙제를 취소하면(다시 낸 숙제가 없을 때) 취소 ·
--                       숙제일부터 14일(올릴 수 있는 기간)이 지나면 기한 지남. 대상 = 학생, 회차 = 반|숙제일
--                       (숙제 없이 올린 시도는 반|u:업로드번호 — 그 시도와 그 뒤 시도만 본다).
--                       맡은 사람 = 그 반 담임(재직) → 숙제를 낸 선생님 → 원장. 알림 수신(원장·관리자 전원 + 담임)은 그대로 둔다.
--   video_unassigned    어느 숙제에도 안 붙은 영상 → 숙제에 배정하거나 제외하면 처리됨(배정한 사람). 영상이 지워지면 취소 ·
--                       올린 지 14일이 지나면 기한 지남. 미배정 판정은 영상 제출 현황과 같은 판정(앱 `videoHomeworkOutcomes`)이
--                       넘겨준 목록 — DB가 따로 판정하지 않는다(어긋나면 화면은 배정됐는데 할 일은 열려 있게 된다).
--   unsent_report       저장만 하고 안 보낸 수업 보고서(발송 콘솔과 같은 게이트 — 앱 `filterUnsentSendable`이 넘겨준 목록) →
--                       발송을 요청하면(대기열에 들어가면) 처리됨(요청한 사람 — 실제로 나갔는지는 '보고서 발송 실패'가 따로 본다).
--                       동명이인 차단은 열어 둔다 · 회수·삭제는 취소 ·
--                       보낼 수 없게 되면(결석·발송 안 하는 반 등) 취소 · 발송 기한(보고서 날 포함 7일)이 지나면 기한 지남.
--                       맡은 사람 = 보고서 실패와 같은 규칙(반 담당 → 보고서의 강사 이름 → 원장).
--
-- 🔴 영상 숙제 미제출(video_homework_missing)은 할 일로 만들지 않는다 — 끝내는 것이 학생의 제출뿐이라 직원이 처리했다는 사실이 남지 않는다
--    (Codex 협의 2026-10-20: 수동 확인 기록도 자동 판정이 덮어써 다시 열린다).
-- 배포 순서: 앱보다 먼저(#95). 되돌리기: 트리거 하나 · 함수 · 0378a의 tg_report_task 본문 · staff_tasks_sync 본문을 다시 실행.
begin;

-- ── 영상 업로드 확인 ──────────────────────────────────────────────────────────
-- 회차 = 반|숙제일 — 숙제 없이 올린 업로드(올리기 사이트 메모)는 반|u:업로드번호(그 시도 하나).
create or replace function staff_tasks_private.video_upload_cycle(p_class uuid, p_route jsonb, p_upload uuid) returns text
language sql immutable as $fn$
  select p_class::text || '|' || coalesce(nullif(p_route ->> 'homeworkDate', ''), 'u:' || p_upload::text)
$fn$;

-- 그 업로드가 영상까지 남겼나 — 업로드 줄의 영상 연결, 또는 연결 칸 갱신이 실패했어도 원래 기록(source='link' · source_ref=업로드).
create or replace function staff_tasks_private.video_upload_landed(p_tenant uuid, p_upload uuid) returns boolean
language sql stable security definer set search_path = public
as $fn$
  select exists (select 1 from public.homework_video_link_uploads u
                   join public.student_homework_videos v on v.id = u.video_id and v.tenant_id = p_tenant and v.status = 'uploaded'
                  where u.id = p_upload and u.tenant_id = p_tenant and u.status = 'completed')
      or exists (select 1 from public.student_homework_videos v
                  where v.tenant_id = p_tenant and v.source = 'link' and v.source_ref = p_upload::text and v.status = 'uploaded');
$fn$;

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

-- 업로드 줄이 바뀌는 순간: 진단 알림이 나가면 할 일을 열고 그 알림에 잇는다 · 완료되면 그 회차를 맞춘다.
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

drop trigger if exists trg_staff_task_video_upload on public.homework_video_link_uploads;
create trigger trg_staff_task_video_upload
  after update of diagnostic_notified_at, status, video_id on public.homework_video_link_uploads
  for each row execute function staff_tasks_private.tg_video_upload_task();

create or replace function staff_tasks_private.sync_video_upload_check(p_tenant uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $fn$
declare
  v_opened int := 0;
  v_closed int := 0;
  v_id uuid;
  x record;
begin
  for x in
    select up.id from public.homework_video_link_uploads up
      join public.homework_video_links l on l.id = up.link_id and l.tenant_id = up.tenant_id
     where up.tenant_id = p_tenant and up.diagnostic_notified_at is not null and up.status <> 'completed'
       and up.created_at >= staff_tasks_private.kind_start('video_upload_check')
       and not exists (select 1 from public.staff_tasks t where t.tenant_id = p_tenant and t.kind = 'video_upload_check'
                        and t.subject_id = l.student_id
                        and t.cycle = staff_tasks_private.video_upload_cycle(l.class_id, up.route, up.id))
  loop
    v_id := staff_tasks_private.open_video_upload_task(x.id);
    if v_id is not null then v_opened := v_opened + 1; end if;
  end loop;
  for x in
    select t.subject_id, t.cycle from public.staff_tasks t
     where t.tenant_id = p_tenant and t.kind = 'video_upload_check' and t.status = 'open'
  loop
    v_closed := v_closed + staff_tasks_private.video_upload_settle(p_tenant, x.subject_id, x.cycle);
  end loop;
  return jsonb_build_object('opened', v_opened, 'closed', v_closed);
end;
$fn$;

-- ── 미배정 영상 ──────────────────────────────────────────────────────────────
-- 아직 미배정으로 둘 수 있는 영상인가(DB가 아는 사실만 — 손 배정 · 자동 제출 · 지움 · 14일). 열기·맞춤이 같이 쓴다.
create or replace function staff_tasks_private.video_unassigned_settle(p_tenant uuid, p_video uuid, p_matched boolean default false)
returns int
language plpgsql security definer set search_path = public
as $fn$
declare
  v record;
  v_by uuid;
  v_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  select lv.id, lv.status, lv.drive_file_id, lv.posted_at into v
    from public.homework_video_ledger_videos lv where lv.tenant_id = p_tenant and lv.id = p_video;
  if v.id is null or v.status <> 'uploaded' or v.drive_file_id is null then
    return staff_tasks_private.close_task(p_tenant, 'video_unassigned', p_video, null, 'cancelled', 'video_removed', null);
  end if;
  -- 순서: 실제 배정·자동 제출(DB 사실) → 14일 → 앱 판정(p_matched). 앱 판정의 14일 창에서 빠진 영상을 '배정됨'으로 닫지 않게.
  select a.updated_by into v_by from public.homework_video_assignments a where a.tenant_id = p_tenant and a.video_id = p_video;
  if found or exists (select 1 from public.video_homework_auto_outcomes o
                 where o.tenant_id = p_tenant and o.video_id = p_video and o.status = 'submitted') then
    return staff_tasks_private.close_task(p_tenant, 'video_unassigned', p_video, null, 'done', 'video_assigned', v_by);
  end if;
  if (v.posted_at at time zone 'Asia/Seoul')::date < v_today - 14 then
    return staff_tasks_private.close_task(p_tenant, 'video_unassigned', p_video, null, 'expired', 'unassigned_window', null);
  end if;
  if p_matched then
    return staff_tasks_private.close_task(p_tenant, 'video_unassigned', p_video, null, 'done', 'video_assigned', null);
  end if;
  return 0;
end;
$fn$;

-- 앱(영상 상태 맞춤)이 부른다: p_checked = 이번에 판정한 영상 전부 · p_unmatched = 그중 미배정(영상 제출 현황과 같은 판정) ·
-- p_open = 미배정 중 알림 대상(영상 숙제를 켠 반·학년). p_open은 연다(알림과 같은 조건 — 어제까지 올린 · 14일 안 · 손 배정·제외 아님),
-- 판정했는데 미배정이 아닌 것은 처리됨으로 닫는다.
create or replace function public.staff_task_sync_unassigned_videos(p_tenant uuid, p_checked uuid[], p_unmatched uuid[], p_open uuid[])
returns jsonb
language plpgsql security definer set search_path = public
as $fn$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v record;
  v_assignees uuid[];
  v_id uuid;
  v_opened int := 0;
  v_closed int := 0;
begin
  if now() < staff_tasks_private.kind_start('video_unassigned') then return jsonb_build_object('opened', 0, 'closed', 0); end if;
  for v in
    select lv.id, lv.student_id, lv.subject, lv.route, lv.posted_at, s.name, raw.teacher_id
      from public.homework_video_ledger_videos lv
      join public.student_homework_videos raw on raw.id = lv.id and raw.tenant_id = p_tenant
      join public.students s on s.id = lv.student_id and s.tenant_id = p_tenant and not s.is_test
     where lv.tenant_id = p_tenant and lv.id = any(coalesce(p_open, '{}')) and lv.status = 'uploaded' and lv.drive_file_id is not null
       and coalesce(lv.route ->> 'manualAssignment', 'false') <> 'true' and coalesce(lv.route ->> 'excluded', 'false') <> 'true'
       and (lv.posted_at at time zone 'Asia/Seoul')::date < v_today
       and (lv.posted_at at time zone 'Asia/Seoul')::date >= v_today - 14
       and not exists (select 1 from public.homework_video_assignments a where a.tenant_id = p_tenant and a.video_id = lv.id)
  loop
    -- 맡은 사람 = 미배정 알림과 같은 규칙(영상의 선생님 · 영상이 가리키는 반의 담임 · 둘 다 없으면 그 과목 지금 반 담임).
    select coalesce(array_agg(distinct u.id), '{}') into v_assignees from public.users u
     where u.tenant_id = p_tenant and u.status = 'active' and u.system_role <> 'student' and (
       u.id = v.teacher_id
       or exists (select 1 from public.classes c where c.tenant_id = p_tenant and c.teacher_id = u.id and c.id::text = v.route ->> 'classId')
       or (v.teacher_id is null and v.route ->> 'classId' is null and exists (
         select 1 from public.enrollments e join public.classes c on c.id = e.class_id and c.tenant_id = p_tenant
          where e.tenant_id = p_tenant and e.student_id = v.student_id and c.teacher_id = u.id and c.is_active
            and (v.subject is null or c.subject = v.subject) and (e.start_date is null or e.start_date <= v_today)
            and (e.end_date is null or e.end_date >= v_today))));
    v_id := staff_tasks_private.open_task(
      p_tenant, 'video_unassigned', v.id, '',
      '미배정 영상',
      coalesce(v.name, '학생') || ' · ' || to_char(v.posted_at at time zone 'Asia/Seoul', 'MM-DD') || ' 올린 영상 — 숙제에 연결하거나 제외',
      '/onescreen/video-homework?from=' || ((v.posted_at at time zone 'Asia/Seoul')::date - 14)::text || '&to=' || v_today::text,
      -- 늦음 = 다음 날이 끝날 때까지 연결 안 함
      ((v_today + 2)::timestamp at time zone 'Asia/Seoul'),
      v_assignees, null);
    if v_id is not null then
      v_opened := v_opened + 1;
      -- 그 사람의 묶음 알림(안 읽은 '미배정 영상 N건')에 잇는다 — 알림은 같은 줄을 고쳐 쓰므로 연결도 그 줄에 더한다.
      insert into public.staff_task_notifications (notification_id, task_id, tenant_id)
      select n.id, v_id, p_tenant from public.notifications n
       where n.tenant_id = p_tenant and n.type = 'video_homework_unassigned' and n.read_at is null and n.archived_at is null
         and n.recipient_id = any(v_assignees)
      on conflict do nothing;
    end if;
  end loop;
  -- 이번에 판정한 영상 중 미배정이 아닌 것 = 연결됨(검사 기록 칸 · 같은 파일 사본 등 앱 판정 포함).
  for v in
    select t.subject_id from public.staff_tasks t
     where t.tenant_id = p_tenant and t.kind = 'video_unassigned' and t.status = 'open'
       and t.subject_id = any(coalesce(p_checked, '{}')) and not (t.subject_id = any(coalesce(p_unmatched, '{}')))
  loop
    v_closed := v_closed + staff_tasks_private.video_unassigned_settle(p_tenant, v.subject_id, true);
  end loop;
  return jsonb_build_object('opened', v_opened, 'closed', v_closed);
end;
$fn$;

create or replace function staff_tasks_private.sync_video_unassigned(p_tenant uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $fn$
declare
  v_closed int := 0;
  x record;
begin
  -- 여는 것은 앱의 영상 판정뿐. 맞춤은 DB가 아는 사실로 닫기만(손 배정 · 자동 제출 · 지움 · 14일).
  for x in select t.subject_id from public.staff_tasks t where t.tenant_id = p_tenant and t.kind = 'video_unassigned' and t.status = 'open' loop
    v_closed := v_closed + staff_tasks_private.video_unassigned_settle(p_tenant, x.subject_id, false);
  end loop;
  return jsonb_build_object('opened', 0, 'closed', v_closed);
end;
$fn$;

-- 손 배정은 그 순간 닫는다(배정한 사람이 처리자).
create or replace function staff_tasks_private.tg_video_assignment_task()
returns trigger
language plpgsql security definer set search_path = public
as $fn$
begin
  if exists (select 1 from public.staff_tasks t where t.tenant_id = NEW.tenant_id and t.kind = 'video_unassigned'
              and t.subject_id = NEW.video_id and t.status = 'open') then
    perform staff_tasks_private.video_unassigned_settle(NEW.tenant_id, NEW.video_id, false);
  end if;
  return null;
exception when others then
  return null;
end;
$fn$;

drop trigger if exists trg_staff_task_video_assignment on public.homework_video_assignments;
create trigger trg_staff_task_video_assignment
  after insert or update on public.homework_video_assignments
  for each row execute function staff_tasks_private.tg_video_assignment_task();

-- ── 미발송 보고서 ────────────────────────────────────────────────────────────
create or replace function staff_tasks_private.unsent_settle(p_tenant uuid, p_report uuid)
returns int
language plpgsql security definer set search_path = public
as $fn$
declare
  r record;
begin
  select lr.id, lr.classnote_status, lr.revoked_at, lr.report_date, lr.classnote_deadline_exempt_at into r
    from public.lesson_reports lr where lr.id = p_report and lr.tenant_id = p_tenant;
  if r.id is null then
    return staff_tasks_private.close_task(p_tenant, 'unsent_report', p_report, null, 'cancelled', 'deleted', null);
  end if;
  if r.revoked_at is not null then
    return staff_tasks_private.close_task(p_tenant, 'unsent_report', p_report, null, 'cancelled', 'revoked', null);
  end if;
  -- 발송 대기열에 들어간 상태만 '요청함'. 동명이인 차단(name_conflict)은 아직 풀어야 할 일이라 열어 둔다.
  if r.classnote_status in ('queued', 'processing', 'success', 'failed') then
    return staff_tasks_private.close_task(p_tenant, 'unsent_report', p_report, null, 'done', 'send_requested', null);
  end if;
  if r.classnote_status = 'recalled' then
    return staff_tasks_private.close_task(p_tenant, 'unsent_report', p_report, null, 'cancelled', 'recalled', null);
  end if;
  if r.classnote_status = 'too_old' then
    return staff_tasks_private.close_task(p_tenant, 'unsent_report', p_report, null, 'expired', 'too_old', null);
  end if;
  if r.report_date < (now() at time zone 'Asia/Seoul')::date - 6 and r.classnote_deadline_exempt_at is null then
    return staff_tasks_private.close_task(p_tenant, 'unsent_report', p_report, null, 'expired', 'deadline', null);
  end if;
  return 0;
end;
$fn$;

-- 앱(미발송 감지 — 발송 콘솔과 같은 게이트)이 부른다: p_reports = 지금 보낼 수 있는 미발송 · p_checked = 이번에 실제로 읽어 판정한 보고서.
-- 목록은 열고, 판정했는데 목록에 없는 열린 할 일은 사실과 맞춘다(요청했으면 처리됨 · 아직인데 빠졌으면 '보낼 수 없게 됨' 취소).
-- 🔴 읽지 않은 보고서(조회 상한 밖)는 건드리지 않는다 — 날짜 범위로 닫으면 상한에 밀린 정상 할 일을 취소한다.
create or replace function public.staff_task_sync_unsent(p_tenant uuid, p_reports uuid[], p_checked uuid[])
returns table (report_id uuid, task_id uuid)
language plpgsql security definer set search_path = public
as $fn$
declare
  r record;
  v_id uuid;
  v_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  for r in
    select lr.id, lr.class_id, lr.teacher_name, lr.report_date, lr.subject, s.name as student_name
      from public.lesson_reports lr
      join public.students s on s.id = lr.student_id and s.tenant_id = p_tenant and not s.is_test
     where lr.tenant_id = p_tenant and lr.id = any(coalesce(p_reports, '{}'))
       and lr.classnote_status is null and lr.revoked_at is null
       and lr.report_date >= (staff_tasks_private.kind_start('unsent_report') at time zone 'Asia/Seoul')::date
  loop
    v_id := staff_tasks_private.open_task(
      p_tenant, 'unsent_report', r.id, '',
      '미발송 수업 보고서',
      coalesce(r.student_name, '학생') || ' · ' || to_char(r.report_date, 'MM-DD') || ' 보고서 — 저장만 하고 보내지 않았습니다',
      '/onescreen',
      -- 늦음 = 찾은 날이 끝날 때까지 안 보냄
      ((v_today + 1)::timestamp at time zone 'Asia/Seoul'),
      staff_tasks_private.report_assignees(p_tenant, r.class_id, r.teacher_name), null);
    if v_id is not null then
      report_id := r.id; task_id := v_id;
      return next;
    end if;
  end loop;
  for r in
    select t.subject_id, lr.classnote_status, lr.revoked_at, lr.id as lid
      from public.staff_tasks t
      left join public.lesson_reports lr on lr.id = t.subject_id and lr.tenant_id = t.tenant_id
     where t.tenant_id = p_tenant and t.kind = 'unsent_report' and t.status = 'open'
       and not (t.subject_id = any(coalesce(p_reports, '{}')))
       and t.subject_id = any(coalesce(p_checked, '{}'))
  loop
    if staff_tasks_private.unsent_settle(p_tenant, r.subject_id) = 0
       and r.classnote_status is distinct from 'name_conflict' then
      perform staff_tasks_private.close_task(p_tenant, 'unsent_report', r.subject_id, null, 'cancelled', 'not_sendable', null);
    end if;
  end loop;
end;
$fn$;

create or replace function staff_tasks_private.sync_unsent_report(p_tenant uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $fn$
declare
  v_closed int := 0;
  x record;
begin
  -- 여는 것은 앱의 미발송 감지뿐(게이트가 앱에 있다). 맞춤은 DB가 아는 사실로 닫기만.
  for x in select t.subject_id from public.staff_tasks t where t.tenant_id = p_tenant and t.kind = 'unsent_report' and t.status = 'open' loop
    v_closed := v_closed + staff_tasks_private.unsent_settle(p_tenant, x.subject_id);
  end loop;
  return jsonb_build_object('opened', 0, 'closed', v_closed);
end;
$fn$;

-- 보고서 트리거(0377a)를 넓힌다 — 실패 할 일 + 미발송 할 일. 둘 다 없으면 색인 한 번 보고 끝.
create or replace function staff_tasks_private.tg_report_task()
returns trigger
language plpgsql security definer set search_path = public
as $fn$
declare
  v_row public.lesson_reports;
  v_actor uuid := auth.uid();
begin
  v_row := case when tg_op = 'DELETE' then OLD else NEW end;
  -- 미발송: 발송을 요청하면(상태가 처음 생기면) 처리됨 · 회수·삭제는 취소.
  if exists (select 1 from public.staff_tasks t where t.tenant_id = v_row.tenant_id and t.kind = 'unsent_report'
              and t.subject_id = v_row.id and t.status = 'open') then
    if tg_op = 'DELETE' then
      perform staff_tasks_private.close_task(OLD.tenant_id, 'unsent_report', OLD.id, null, 'cancelled', 'deleted', v_actor);
    elsif NEW.revoked_at is not null and OLD.revoked_at is null then
      perform staff_tasks_private.close_task(NEW.tenant_id, 'unsent_report', NEW.id, null, 'cancelled', 'revoked', v_actor);
    elsif NEW.classnote_status is distinct from OLD.classnote_status then
      if NEW.classnote_status in ('queued', 'processing', 'success', 'failed') then
        perform staff_tasks_private.close_task(NEW.tenant_id, 'unsent_report', NEW.id, null, 'done', 'send_requested', v_actor);
      elsif NEW.classnote_status = 'recalled' then
        perform staff_tasks_private.close_task(NEW.tenant_id, 'unsent_report', NEW.id, null, 'cancelled', 'recalled', v_actor);
      end if;
    end if;
  end if;

  if not exists (select 1 from public.staff_tasks t where t.tenant_id = v_row.tenant_id and t.kind = 'report_send_failed'
                  and t.subject_id = v_row.id and t.status in ('open', 'expired')) then
    return null;
  end if;
  if tg_op = 'DELETE' then
    perform staff_tasks_private.close_task(OLD.tenant_id, 'report_send_failed', OLD.id, null, 'cancelled', 'deleted', v_actor);
  elsif NEW.revoked_at is not null and OLD.revoked_at is null then
    perform staff_tasks_private.close_task(NEW.tenant_id, 'report_send_failed', NEW.id, null, 'cancelled', 'revoked', v_actor);
  elsif NEW.classnote_status is distinct from OLD.classnote_status then
    if NEW.classnote_status = 'success' then
      perform staff_tasks_private.close_task(NEW.tenant_id, 'report_send_failed', NEW.id, null, 'done', 'sent', v_actor);
    elsif NEW.classnote_status = 'recalled' then
      perform staff_tasks_private.close_task(NEW.tenant_id, 'report_send_failed', NEW.id, null, 'cancelled', 'recalled', v_actor);
    elsif NEW.classnote_status = 'too_old' then
      perform staff_tasks_private.close_task(NEW.tenant_id, 'report_send_failed', NEW.id, null, 'expired', 'too_old', null);
    elsif NEW.classnote_status = 'queued' then
      update public.staff_tasks set last_actor_id = coalesce(v_actor, last_actor_id), updated_at = now()
       where tenant_id = NEW.tenant_id and kind = 'report_send_failed' and subject_id = NEW.id and status = 'open';
      insert into public.staff_task_events (tenant_id, task_id, event, actor_id)
      select NEW.tenant_id, t.id, 'retry_requested', v_actor from public.staff_tasks t
       where t.tenant_id = NEW.tenant_id and t.kind = 'report_send_failed' and t.subject_id = NEW.id and t.status = 'open';
    end if;
  end if;
  return null;
exception when others then
  return null;
end;
$fn$;

-- ── 30분 맞춤 = 종류 다섯 더 ─────────────────────────────────────────────────
create or replace function staff_tasks_private.kind_start(p_kind text) returns timestamptz
language sql immutable as $fn$
  select case p_kind
    when 'report_send_failed' then timestamptz '2026-10-20 00:00+09'
    when 'followup_due' then timestamptz '2026-10-20 00:00+09'
    else timestamptz '2026-10-21 00:00+09'
  end
$fn$;

create or replace function public.staff_tasks_sync(p_tenant uuid, p_kinds text[] default null)
returns jsonb
language plpgsql security definer set search_path = public
as $fn$
declare
  v_kind text;
  v_one jsonb;
  v_opened int := 0;
  v_closed int := 0;
  v_errors jsonb := '{}';
begin
  foreach v_kind in array coalesce(p_kinds, array['report_send_failed', 'followup_due', 'progress_anomaly', 'attendance_absent_desk',
                                                   'video_upload_check', 'video_unassigned', 'unsent_report']) loop
    begin
      v_one := case v_kind
        when 'report_send_failed' then staff_tasks_private.sync_report_send_failed(p_tenant)
        when 'followup_due' then staff_tasks_private.sync_followup_due(p_tenant)
        when 'progress_anomaly' then staff_tasks_private.sync_progress_anomaly(p_tenant)
        when 'attendance_absent_desk' then staff_tasks_private.sync_attendance_absent_desk(p_tenant)
        when 'video_upload_check' then staff_tasks_private.sync_video_upload_check(p_tenant)
        when 'video_unassigned' then staff_tasks_private.sync_video_unassigned(p_tenant)
        when 'unsent_report' then staff_tasks_private.sync_unsent_report(p_tenant)
        else null
      end;
      v_opened := v_opened + coalesce((v_one ->> 'opened')::int, 0);
      v_closed := v_closed + coalesce((v_one ->> 'closed')::int, 0);
    exception when others then
      v_errors := v_errors || jsonb_build_object(v_kind, sqlerrm);
    end;
  end loop;
  return jsonb_build_object('opened', v_opened, 'closed', v_closed, 'errors', v_errors);
end;
$fn$;

revoke all on function public.staff_task_sync_unassigned_videos(uuid, uuid[], uuid[], uuid[]), public.staff_task_sync_unsent(uuid, uuid[], uuid[])
  from public, anon, authenticated;
grant execute on function public.staff_task_sync_unassigned_videos(uuid, uuid[], uuid[], uuid[]), public.staff_task_sync_unsent(uuid, uuid[], uuid[])
  to service_role;
revoke all on all functions in schema staff_tasks_private from public, anon, authenticated;
grant execute on all functions in schema staff_tasks_private to service_role;

notify pgrst, 'reload schema';
commit;
