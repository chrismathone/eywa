-- 0378a — 업무 처리 확인 4단계 a(0377a 위에): 공통 보강 + 종류 둘(진도 기록 이상 · 결석 확인 전화).
--
-- 공통 보강(Codex 협의 2026-10-20):
--   · 30분 맞춤을 종류별 함수(sync_<종류>)로 나누고 종류마다 따로 감싼다 — 한 종류가 실패해도 나머지는 돈다.
--     결과에 종류별 오류를 돌려준다(조용히 삼키지 않는다). 알림 직전 연결(link.ts)은 그 종류만 맞춘다.
--   · open_task: 맡을 사람이 아무도 없으면 새 할 일을 만들지 않는다(주인 없는 일 금지). 기한을 다시 맞추는 선택지.
--   · 알림 ↔ 할 일 연결표(staff_task_notifications) — 알림 하나가 여러 할 일을 알리는 묶음(결석 N명 · 학생별 진도 이상 N건).
--
-- 새 종류(도입한 날부터 생긴 것만):
--   progress_anomaly     진도 기록 이상(jump_error · overlap_error) 한 건 → '이상 없음 확인'(resolved_at)으로 처리됨
--                        (확인한 사람이 처리자). 확인을 되돌리면 다시 열림 · 기록이 지워지면 취소.
--                        맡은 사람 = 그 학생의 지금 수학 반 담임(알림과 같은 과목 범위), 없으면 원장 전원.
--   attendance_absent_desk 강사가 결석을 입력함 → 데스크가 학부모 확인을 매듭지으면(출결 확인 큐에서 '처리함'·'확인 불필요',
--                        결석을 보고 남긴 조치) 처리됨(남긴 사람이 처리자). 그 칸이 더는 결석이 아니면(출석으로 정정·삭제) 취소.
--                        맡은 사람 = 출결 알림을 켠 계정 전원(함께 맡음 — 알림 수신과 같다). 회차 = 날짜|교시('' = 그날 전체).
--                        늦음 = 입력한 다음 날 0시. 7일이 지나도 안 매듭지으면 기한 지남(밀린 목록이 끝없이 쌓이지 않게).
--
-- 🔴 출결 표(attendance_records)의 트리거는 '그 학생의 열린 결석 확인 할 일'이 있을 때만 일한다(색인 한 번 — 매일 수백 번 저장되는 표).
-- 배포 순서: 앱보다 먼저(#95). 앱 없이 적용돼도 동작은 같다(할 일은 서버 전용 · 벨은 종류 이름을 몰라도 '할 일'로 보인다).
-- 되돌리기: 트리거 셋 · 새 함수 · staff_task_notifications 를 지우고 0377a의 open_task · staff_tasks_sync 본문을 다시 실행.
begin;

-- ── 알림 ↔ 할 일 연결(묶음 알림) ─────────────────────────────────────────────
create table if not exists public.staff_task_notifications (
  notification_id uuid not null references public.notifications(id) on delete cascade,
  task_id uuid not null references public.staff_tasks(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  primary key (notification_id, task_id)
);
create index if not exists staff_task_notifications_task_idx on public.staff_task_notifications (task_id);
create index if not exists staff_task_notifications_tenant_idx on public.staff_task_notifications (tenant_id);
alter table public.staff_task_notifications enable row level security;
revoke all on public.staff_task_notifications from public, anon, authenticated;
grant all on public.staff_task_notifications to service_role;

-- ── open_task: 주인 없는 새 할 일 금지 + 기한 다시 맞추기 ───────────────────────
drop function if exists staff_tasks_private.open_task(uuid, text, uuid, text, text, text, text, timestamptz, uuid[], uuid);
create or replace function staff_tasks_private.open_task(
  p_tenant uuid, p_kind text, p_subject uuid, p_cycle text,
  p_title text, p_detail text, p_link text, p_due timestamptz, p_assignees uuid[], p_actor uuid default null,
  p_refresh_due boolean default false
) returns uuid
language plpgsql security definer set search_path = public
as $fn$
declare
  v_id uuid;
  v_status text;
  v_new uuid[];
begin
  -- 맡은 사람 = 같은 학원의 재직 중인 사람만.
  select coalesce(array_agg(u.id), '{}') into v_new
    from public.users u where u.tenant_id = p_tenant and u.status = 'active' and u.id = any(coalesce(p_assignees, '{}'));

  select id, status into v_id, v_status from public.staff_tasks
   where tenant_id = p_tenant and kind = p_kind and subject_id = p_subject and cycle = p_cycle
   for update;
  if v_id is null then
    -- 🔴 맡을 사람이 아무도 없으면 만들지 않는다 — 아무도 안 보는 할 일은 '늦음'만 쌓는다(부르는 쪽이 폴백을 준다).
    if cardinality(v_new) = 0 then return null; end if;
    insert into public.staff_tasks (tenant_id, kind, subject_id, cycle, title, detail, link, due_at)
    values (p_tenant, p_kind, p_subject, p_cycle, p_title, p_detail, p_link, p_due)
    on conflict (tenant_id, kind, subject_id, cycle) do nothing
    returning id into v_id;
    if v_id is null then
      select id, status into v_id, v_status from public.staff_tasks
       where tenant_id = p_tenant and kind = p_kind and subject_id = p_subject and cycle = p_cycle for update;
    else
      insert into public.staff_task_events (tenant_id, task_id, event, actor_id) values (p_tenant, v_id, 'opened', p_actor);
      v_status := 'open';
    end if;
  end if;
  if v_status is distinct from 'open' then
    update public.staff_tasks
       set status = 'open', closed_at = null, closed_by = null, close_reason = null, opened_at = now(),
           title = p_title, detail = p_detail, link = p_link, due_at = p_due, updated_at = now()
     where id = v_id;
    insert into public.staff_task_events (tenant_id, task_id, event, actor_id) values (p_tenant, v_id, 'reopened', p_actor);
  else
    -- 열린 일은 글만 맞춘다. 늦음 기준은 처음 연 때 그대로 — 부르는 쪽이 '기한이 바뀌었다'고 할 때만(p_refresh_due) 옮긴다.
    update public.staff_tasks
       set title = p_title, detail = p_detail, link = p_link,
           due_at = case when p_refresh_due then p_due else due_at end, updated_at = now()
     where id = v_id
       and ((title, detail, link) is distinct from (p_title, p_detail, p_link)
            or (p_refresh_due and due_at is distinct from p_due));
  end if;

  -- 명단이 비면 기존 담당을 그대로 둔다(재직자가 다 빠져도 원래 맡은 사람의 기록은 남는다).
  if cardinality(v_new) > 0 then
    delete from public.staff_task_assignees where task_id = v_id and not (user_id = any(v_new));
    with added as (
      insert into public.staff_task_assignees (task_id, user_id, tenant_id)
      select v_id, x, p_tenant from unnest(v_new) x
      on conflict do nothing returning user_id
    )
    insert into public.staff_task_events (tenant_id, task_id, event, actor_id, note)
    select p_tenant, v_id, 'assigned', p_actor, string_agg(a.user_id::text, ',') from added a having count(*) > 0;
  end if;
  return v_id;
end;
$fn$;

-- 보고서 실패 담당(0377a) — 반 담당이 퇴사했으면 다음 단계로 넘긴다(open_task가 재직자만 남기므로, 넘기지 않으면 할 일이 안 열린다).
create or replace function staff_tasks_private.report_assignees(p_tenant uuid, p_class uuid, p_teacher_name text)
returns uuid[]
language sql stable security definer set search_path = public
as $fn$
  select coalesce(
    (select array[c.teacher_id] from public.classes c
      where c.id = p_class and c.tenant_id = p_tenant and c.teacher_id is not null
        and exists (select 1 from public.users tu where tu.id = c.teacher_id and tu.tenant_id = p_tenant and tu.status = 'active')),
    (select array[u.id] from public.users u
      where u.tenant_id = p_tenant and u.status = 'active' and coalesce(p_teacher_name, '') <> '' and u.display_name = p_teacher_name
      limit 1),
    (select array_agg(u.id) from public.users u where u.tenant_id = p_tenant and u.status = 'active' and u.system_role = 'master'),
    '{}'::uuid[]);
$fn$;

-- 도입한 날 — 종류마다 따로 적는다(새 종류는 그 종류가 운영에 들어간 날).
create or replace function staff_tasks_private.kind_start(p_kind text) returns timestamptz
language sql immutable as $fn$
  select case p_kind
    when 'report_send_failed' then timestamptz '2026-10-20 00:00+09'
    when 'followup_due' then timestamptz '2026-10-20 00:00+09'
    else timestamptz '2026-10-21 00:00+09'
  end
$fn$;

-- 원장 전원(폴백 담당).
create or replace function staff_tasks_private.master_ids(p_tenant uuid) returns uuid[]
language sql stable security definer set search_path = public
as $fn$
  select coalesce(array_agg(u.id), '{}') from public.users u
   where u.tenant_id = p_tenant and u.status = 'active' and u.system_role = 'master';
$fn$;

-- ── 0377a 두 종류의 맞춤을 종류별 함수로(본문은 0377a 그대로) ────────────────────
create or replace function staff_tasks_private.sync_report_send_failed(p_tenant uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $fn$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_opened int := 0;
  v_closed int := 0;
  v_id uuid;
  x record;
begin
  for x in
    select lr.id from public.lesson_reports lr
     where lr.tenant_id = p_tenant and lr.classnote_status = 'failed' and lr.revoked_at is null
       and coalesce(lr.classnote_processing_at, lr.classnote_queued_at) >= staff_tasks_private.kind_start('report_send_failed')
       and (lr.report_date >= v_today - 6 or lr.classnote_deadline_exempt_at is not null)
       and not exists (select 1 from public.staff_tasks t where t.tenant_id = p_tenant and t.kind = 'report_send_failed'
                        and t.subject_id = lr.id and t.status = 'open')
       and not exists (select 1 from public.students s where s.id = lr.student_id and s.tenant_id = p_tenant and s.is_test)
  loop
    v_id := staff_tasks_private.open_report_task(x.id);
    if v_id is not null then v_opened := v_opened + 1; end if;
  end loop;

  for x in
    select t.subject_id, lr.id as report_id, lr.classnote_status, lr.revoked_at, lr.report_date, lr.classnote_deadline_exempt_at, t.status
      from public.staff_tasks t
      left join public.lesson_reports lr on lr.id = t.subject_id and lr.tenant_id = t.tenant_id
     where t.tenant_id = p_tenant and t.kind = 'report_send_failed' and t.status in ('open', 'expired')
  loop
    if x.report_id is null then
      v_closed := v_closed + staff_tasks_private.close_task(p_tenant, 'report_send_failed', x.subject_id, null, 'cancelled', 'deleted', null);
    elsif x.classnote_status = 'success' then
      v_closed := v_closed + staff_tasks_private.close_task(p_tenant, 'report_send_failed', x.subject_id, null, 'done', 'sent', null);
    elsif x.status = 'open' and x.revoked_at is not null then
      v_closed := v_closed + staff_tasks_private.close_task(p_tenant, 'report_send_failed', x.subject_id, null, 'cancelled', 'revoked', null);
    elsif x.status = 'open' and x.classnote_status = 'recalled' then
      v_closed := v_closed + staff_tasks_private.close_task(p_tenant, 'report_send_failed', x.subject_id, null, 'cancelled', 'recalled', null);
    elsif x.status = 'open' and (x.classnote_status = 'too_old'
          or (x.report_date < v_today - 6 and x.classnote_deadline_exempt_at is null)) then
      v_closed := v_closed + staff_tasks_private.close_task(p_tenant, 'report_send_failed', x.subject_id, null, 'expired', 'deadline', null);
    end if;
  end loop;
  return jsonb_build_object('opened', v_opened, 'closed', v_closed);
end;
$fn$;

create or replace function staff_tasks_private.sync_followup_due(p_tenant uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $fn$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_opened int := 0;
  v_closed int := 0;
  v_id uuid;
  x record;
begin
  for x in
    select sc.id from public.student_consultations sc
     where sc.tenant_id = p_tenant and not sc.follow_up_done and sc.follow_up_date is not null
       and sc.follow_up_date <= v_today and sc.follow_up_date >= staff_tasks_private.followup_start()
       and not exists (select 1 from public.staff_tasks t where t.tenant_id = p_tenant and t.kind = 'followup_due'
                        and t.subject_id = sc.id and t.cycle = sc.follow_up_date::text)
  loop
    v_id := staff_tasks_private.open_followup_task(x.id);
    if v_id is not null then v_opened := v_opened + 1; end if;
  end loop;

  for x in
    select t.subject_id, t.cycle, sc.id as cid, sc.follow_up_done, sc.follow_up_date
      from public.staff_tasks t
      left join public.student_consultations sc on sc.id = t.subject_id and sc.tenant_id = t.tenant_id
     where t.tenant_id = p_tenant and t.kind = 'followup_due' and t.status = 'open'
  loop
    if x.cid is null then
      v_closed := v_closed + staff_tasks_private.close_task(p_tenant, 'followup_due', x.subject_id, x.cycle, 'cancelled', 'deleted', null);
    elsif x.follow_up_done then
      v_closed := v_closed + staff_tasks_private.close_task(p_tenant, 'followup_due', x.subject_id, x.cycle, 'done', 'followup_done', null);
    elsif x.follow_up_date is null or x.follow_up_date::text <> x.cycle then
      v_closed := v_closed + staff_tasks_private.close_task(p_tenant, 'followup_due', x.subject_id, x.cycle, 'cancelled', 'rescheduled', null);
    end if;
  end loop;
  return jsonb_build_object('opened', v_opened, 'closed', v_closed);
end;
$fn$;

-- ── 진도 기록 이상 ────────────────────────────────────────────────────────────
-- 맡은 사람 = 그 학생의 지금 수학 반 담임(재직) — 진도 파이프라인이 수학 전용이라 알림과 같은 과목 범위. 없으면 원장 전원.
create or replace function staff_tasks_private.student_math_teachers(p_tenant uuid, p_student uuid) returns uuid[]
language sql stable security definer set search_path = public
as $fn$
  select coalesce(array_agg(distinct c.teacher_id), '{}')
    from public.enrollments e
    join public.classes c on c.id = e.class_id and c.tenant_id = p_tenant
    join public.users u on u.id = c.teacher_id and u.tenant_id = p_tenant and u.status = 'active'
   where e.tenant_id = p_tenant and e.student_id = p_student
     and c.is_active and c.subject = 'math'
     and e.start_date <= (now() at time zone 'Asia/Seoul')::date
     and not coalesce(e.on_hold, false)
     -- 반이동으로 닫힌 수강은 그날 이미 새 반(반열림) · 일반 종료는 종료일까지 다닌다(#125)
     and (e.end_date is null
          or (e.is_transferred and e.end_date > (now() at time zone 'Asia/Seoul')::date)
          or (not e.is_transferred and e.end_date >= (now() at time zone 'Asia/Seoul')::date));
$fn$;

create or replace function staff_tasks_private.open_progress_task(p_event uuid, p_actor uuid default null)
returns uuid
language plpgsql security definer set search_path = public
as $fn$
declare
  ev record;
  v_student text;
  v_assignees uuid[];
  v_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  select pe.id, pe.tenant_id, pe.student_id, pe.event_type, pe.created_at, pe.resolved_at
    into ev from public.progress_events pe where pe.id = p_event;
  if ev.id is null or ev.resolved_at is not null or ev.event_type not in ('jump_error', 'overlap_error')
     or ev.created_at < staff_tasks_private.kind_start('progress_anomaly') then
    return null;
  end if;
  if exists (select 1 from public.students s where s.id = ev.student_id and s.tenant_id = ev.tenant_id and s.is_test) then
    return null;
  end if;
  select s.name into v_student from public.students s where s.id = ev.student_id and s.tenant_id = ev.tenant_id;
  v_assignees := staff_tasks_private.student_math_teachers(ev.tenant_id, ev.student_id);
  if cardinality(v_assignees) = 0 then v_assignees := staff_tasks_private.master_ids(ev.tenant_id); end if;
  return staff_tasks_private.open_task(
    ev.tenant_id, 'progress_anomaly', ev.id, '',
    '진도 기록 이상',
    coalesce(v_student, '학생') || ' · ' || case ev.event_type when 'jump_error' then '진도 점프' else '선행·현행 겹침' end
      || ' (' || to_char(ev.created_at at time zone 'Asia/Seoul', 'MM-DD') || ')',
    '/students/' || ev.student_id::text || '?tab=progress',
    -- 늦음 = 생긴 다음 날이 끝날 때까지 확인 안 함(기준은 이상이 생긴 날 — 맞춤이 늦게 열어도 같은 기한)
    ((((ev.created_at at time zone 'Asia/Seoul')::date) + 2)::timestamp at time zone 'Asia/Seoul'),
    v_assignees, p_actor);
end;
$fn$;

create or replace function staff_tasks_private.tg_progress_task()
returns trigger
language plpgsql security definer set search_path = public
as $fn$
begin
  if tg_op = 'DELETE' then
    if OLD.event_type in ('jump_error', 'overlap_error') then
      perform staff_tasks_private.close_task(OLD.tenant_id, 'progress_anomaly', OLD.id, null, 'cancelled', 'deleted', auth.uid());
    end if;
    return null;
  end if;
  if NEW.event_type not in ('jump_error', 'overlap_error') then return null; end if;
  if NEW.resolved_at is not null and (tg_op = 'INSERT' or OLD.resolved_at is null) then
    perform staff_tasks_private.close_task(NEW.tenant_id, 'progress_anomaly', NEW.id, null, 'done', 'anomaly_resolved',
      coalesce(NEW.resolved_by, auth.uid()));
  elsif NEW.resolved_at is null and (tg_op = 'INSERT' or OLD.resolved_at is not null) then
    -- 새 이상 · 확인 되돌리기 → (다시) 연다.
    perform staff_tasks_private.open_progress_task(NEW.id, auth.uid());
  end if;
  return null;
exception when others then
  return null; -- 할 일 기록이 진도 저장을 막지 않는다(30분 맞춤이 메운다).
end;
$fn$;

drop trigger if exists trg_staff_task_progress on public.progress_events;
create trigger trg_staff_task_progress
  after insert or update of resolved_at or delete on public.progress_events
  for each row execute function staff_tasks_private.tg_progress_task();

create or replace function staff_tasks_private.sync_progress_anomaly(p_tenant uuid)
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
    select pe.id from public.progress_events pe
     where pe.tenant_id = p_tenant and pe.event_type in ('jump_error', 'overlap_error') and pe.resolved_at is null
       and pe.created_at >= staff_tasks_private.kind_start('progress_anomaly')
       and not exists (select 1 from public.staff_tasks t where t.tenant_id = p_tenant and t.kind = 'progress_anomaly'
                        and t.subject_id = pe.id)
  loop
    v_id := staff_tasks_private.open_progress_task(x.id);
    if v_id is not null then v_opened := v_opened + 1; end if;
  end loop;

  for x in
    select t.subject_id, pe.id as eid, pe.resolved_at, pe.resolved_by
      from public.staff_tasks t
      left join public.progress_events pe on pe.id = t.subject_id and pe.tenant_id = t.tenant_id
     where t.tenant_id = p_tenant and t.kind = 'progress_anomaly' and t.status = 'open'
  loop
    if x.eid is null then
      v_closed := v_closed + staff_tasks_private.close_task(p_tenant, 'progress_anomaly', x.subject_id, null, 'cancelled', 'deleted', null);
    elsif x.resolved_at is not null then
      v_closed := v_closed + staff_tasks_private.close_task(p_tenant, 'progress_anomaly', x.subject_id, null, 'done', 'anomaly_resolved', x.resolved_by);
    end if;
  end loop;
  -- 열린 일의 맡은 사람을 지금 수학 반 담임으로 다시 맞춘다(반이동·담임 변경 — 기한은 그대로).
  for x in select t.subject_id from public.staff_tasks t where t.tenant_id = p_tenant and t.kind = 'progress_anomaly' and t.status = 'open' loop
    perform staff_tasks_private.open_progress_task(x.subject_id);
  end loop;
  -- 확인을 되돌렸는데 트리거가 놓친 것 — 닫힌 '처리됨'을 다시 연다.
  for x in
    select t.subject_id from public.staff_tasks t
      join public.progress_events pe on pe.id = t.subject_id and pe.tenant_id = t.tenant_id
     where t.tenant_id = p_tenant and t.kind = 'progress_anomaly' and t.status = 'done' and pe.resolved_at is null
  loop
    v_id := staff_tasks_private.open_progress_task(x.subject_id);
    if v_id is not null then v_opened := v_opened + 1; end if;
  end loop;
  return jsonb_build_object('opened', v_opened, 'closed', v_closed);
end;
$fn$;

-- ── 결석 확인 전화 ───────────────────────────────────────────────────────────
-- 출결의 지금 값 = 학생·반·날짜·교시마다 최신 줄 하나(recorded_at → id 내림차순 — 출결 화면과 같은 규칙).
-- 반환: 교시('' = 그날 전체 줄) · 그 교시가 결석인가.
create or replace function staff_tasks_private.absent_cells(p_tenant uuid, p_student uuid, p_date date)
returns table (slot text, absent boolean)
language sql stable security definer set search_path = public
as $fn$
  with latest as (
    select r.status::text as status, coalesce(to_char(r.slot_start, 'HH24:MI'), '') as slot,
           row_number() over (partition by r.class_id, r.slot_start order by r.recorded_at desc nulls last, r.id desc) as rn
      from public.attendance_records r
     where r.tenant_id = p_tenant and r.student_id = p_student and r.session_date = p_date
  )
  select slot, bool_or(status = 'absent') from latest where rn = 1 group by slot;
$fn$;

-- 그 회차가 지금 결석인가. 교시 회차 = 그 교시 줄(없으면 그날 전체 줄) · 그날 전체 회차('') = 어느 줄이든 결석.
create or replace function staff_tasks_private.absent_now(p_tenant uuid, p_student uuid, p_date date, p_slot text)
returns boolean
language sql stable security definer set search_path = public
as $fn$
  with c as (select * from staff_tasks_private.absent_cells(p_tenant, p_student, p_date))
  select case
    when p_slot = '' then exists (select 1 from c where absent)
    when exists (select 1 from c where slot = p_slot) then exists (select 1 from c where slot = p_slot and absent)
    else exists (select 1 from c where slot = '' and absent)
  end;
$fn$;

-- 데스크가 그 칸을 결석을 보고 매듭지었나 + 누가(loadFollowups·isSettled 규칙: 교시 조치가 먼저, 없으면 그날 전체 조치 ·
-- 결석이 아닌 신호로 매듭지은 조치는 결석으로 올라서면 다시 열린 것으로 본다).
create or replace function staff_tasks_private.absent_slot_settled(p_tenant uuid, p_student uuid, p_date date, p_slot text)
returns table (settled boolean, handled_by uuid)
language sql stable security definer set search_path = public
as $fn$
  with pick as (
    select f.state, f.signal, f.handled_by
      from public.attendance_followups f
     where f.tenant_id = p_tenant and f.student_id = p_student and f.session_date = p_date
       and ((p_slot <> '' and to_char(f.slot_start, 'HH24:MI') = p_slot) or f.slot_start is null)
     order by (f.slot_start is null)
     limit 1
  )
  select coalesce((select state in ('resolved', 'dismissed') and signal = 'absent' from pick), false),
         (select handled_by from pick);
$fn$;

-- 회차 단위 매듭. 그날 전체 회차('')는 그날 전체 조치가 있거나, 결석인 교시가 모두 매듭지어졌으면 매듭.
create or replace function staff_tasks_private.absent_settled_by(p_tenant uuid, p_student uuid, p_date date, p_slot text)
returns table (settled boolean, handled_by uuid)
language plpgsql stable security definer set search_path = public
as $fn$
declare
  v_ok boolean;
  v_by uuid;
  c record;
  v_any boolean := false;
begin
  select x.settled, x.handled_by into v_ok, v_by from staff_tasks_private.absent_slot_settled(p_tenant, p_student, p_date, p_slot) x;
  if v_ok or p_slot <> '' then
    settled := v_ok; handled_by := v_by; return next; return;
  end if;
  -- 그날 전체 회차인데 데스크는 교시별로 남겼다 — 결석인 교시가 모두 매듭지어졌으면 매듭(마지막 처리자).
  for c in select a.slot from staff_tasks_private.absent_cells(p_tenant, p_student, p_date) a where a.absent and a.slot <> '' loop
    v_any := true;
    select x.settled, x.handled_by into v_ok, v_by from staff_tasks_private.absent_slot_settled(p_tenant, p_student, p_date, c.slot) x;
    if not v_ok then settled := false; handled_by := null; return next; return; end if;
  end loop;
  settled := v_any; handled_by := case when v_any then v_by end;
  return next;
end;
$fn$;

create or replace function staff_tasks_private.open_absent_task(p_tenant uuid, p_student uuid, p_date date, p_slot text, p_actor uuid default null)
returns uuid
language plpgsql security definer set search_path = public
as $fn$
declare
  v_slot text := left(coalesce(p_slot, ''), 5);
  v_student text;
  v_assignees uuid[];
  v_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  -- 결석 확인은 지난 7일 안의 결석만(그보다 오래된 정정은 지금 전화할 일이 아니다 — 7일이 지나면 기한 지남과 같은 기준).
  if p_date is null or p_date > v_today or p_date < v_today - 7 or now() < staff_tasks_private.kind_start('attendance_absent_desk') then return null; end if;
  if v_slot <> '' and v_slot !~ '^\d{2}:\d{2}$' then return null; end if;
  if exists (select 1 from public.students s where s.id = p_student and s.tenant_id = p_tenant and s.is_test) then return null; end if;
  -- 교시 없이 저장했는데 실제 결석 줄이 교시 줄이면(원스크린이 교시 줄을 고친 경우) 그 교시로 연다.
  if v_slot = '' and not exists (select 1 from staff_tasks_private.absent_cells(p_tenant, p_student, p_date) a where a.slot = '' and a.absent) then
    select min(a.slot) into v_slot from staff_tasks_private.absent_cells(p_tenant, p_student, p_date) a where a.absent and a.slot <> '';
    v_slot := coalesce(v_slot, '');
  end if;
  if not staff_tasks_private.absent_now(p_tenant, p_student, p_date, v_slot) then return null; end if;
  if (select x.settled from staff_tasks_private.absent_settled_by(p_tenant, p_student, p_date, v_slot) x) then return null; end if;
  select s.name into v_student from public.students s where s.id = p_student and s.tenant_id = p_tenant;
  -- 맡은 사람 = 출결 알림을 켠 재직 계정 전원(결석 알림 수신과 같다). 아무도 안 켰으면 만들지 않는다.
  select coalesce(array_agg(u.id), '{}') into v_assignees from public.users u
   where u.tenant_id = p_tenant and u.status = 'active' and u.attendance_alert_optin;
  return staff_tasks_private.open_task(
    p_tenant, 'attendance_absent_desk', p_student, p_date::text || '|' || v_slot,
    '결석 확인 전화',
    coalesce(v_student, '학생') || ' · ' || to_char(p_date, 'MM-DD') || case when v_slot <> '' then ' ' || v_slot else '' end
      || ' 결석 — 학부모 확인',
    '/attendance/live?tab=desk&date=' || p_date::text,
    -- 늦음 = 결석한 날 다음 날 0시와 입력한 날 다음 날 0시 중 늦은 쪽(어제 결석을 오늘 입력하면 오늘 하루는 여유)
    ((greatest(p_date, v_today) + 1)::timestamp at time zone 'Asia/Seoul'),
    v_assignees, p_actor);
end;
$fn$;

-- 결석 확인 할 일 하나를 지금 사실과 맞춘다(트리거 · 맞춤이 같이 쓴다). 매듭 → 처리됨 · 결석 아님 → 취소 · 7일 → 기한 지남 ·
-- '처리됨'인데 데스크 조치가 되돌려졌으면(열림으로 다시 저장 · 미확인으로 덮임) 다시 연다. 바뀐 건수.
create or replace function staff_tasks_private.settle_absent_task(p_tenant uuid, p_student uuid, p_cycle text)
returns int
language plpgsql security definer set search_path = public
as $fn$
declare
  v_date date := split_part(p_cycle, '|', 1)::date;
  v_slot text := split_part(p_cycle, '|', 2);
  v_status text;
  v_reason text;
  v_settled boolean;
  v_by uuid;
begin
  select status, close_reason into v_status, v_reason from public.staff_tasks
   where tenant_id = p_tenant and kind = 'attendance_absent_desk' and subject_id = p_student and cycle = p_cycle;
  select x.settled, x.handled_by into v_settled, v_by from staff_tasks_private.absent_settled_by(p_tenant, p_student, v_date, v_slot) x;
  -- 닫힌 것 중 다시 열 일: 데스크 매듭이 되돌려졌거나(처리됨) · 출석으로 정정했다가 다시 결석이 됐다(취소).
  if (v_status = 'done' and v_reason = 'desk_settled') or (v_status = 'cancelled' and v_reason = 'not_absent') then
    if not v_settled and staff_tasks_private.absent_now(p_tenant, p_student, v_date, v_slot)
       and v_date >= (now() at time zone 'Asia/Seoul')::date - 7 then
      perform staff_tasks_private.open_absent_task(p_tenant, p_student, v_date, v_slot);
      return 1;
    end if;
    return 0;
  end if;
  if v_status is distinct from 'open' then return 0; end if;
  if v_settled then
    return staff_tasks_private.close_task(p_tenant, 'attendance_absent_desk', p_student, p_cycle, 'done', 'desk_settled', v_by);
  end if;
  if not staff_tasks_private.absent_now(p_tenant, p_student, v_date, v_slot) then
    return staff_tasks_private.close_task(p_tenant, 'attendance_absent_desk', p_student, p_cycle, 'cancelled', 'not_absent', null);
  end if;
  if v_date < (now() at time zone 'Asia/Seoul')::date - 7 then
    return staff_tasks_private.close_task(p_tenant, 'attendance_absent_desk', p_student, p_cycle, 'expired', 'stale', null);
  end if;
  return 0;
end;
$fn$;

-- 그 학생·그날의 결석 확인 할 일(열린 것 + 데스크 매듭으로 닫힌 것)을 맞춘다.
create or replace function staff_tasks_private.settle_absent_day(p_tenant uuid, p_student uuid, p_date date)
returns int
language plpgsql security definer set search_path = public
as $fn$
declare
  x record;
  v_n int := 0;
begin
  for x in
    select t.cycle from public.staff_tasks t
     where t.tenant_id = p_tenant and t.kind = 'attendance_absent_desk' and t.subject_id = p_student
       and t.cycle like p_date::text || '|%'
       and (t.status = 'open' or (t.status = 'done' and t.close_reason = 'desk_settled')
            or (t.status = 'cancelled' and t.close_reason = 'not_absent'))
  loop
    v_n := v_n + staff_tasks_private.settle_absent_task(p_tenant, p_student, x.cycle);
  end loop;
  return v_n;
end;
$fn$;

create or replace function staff_tasks_private.tg_absent_followup()
returns trigger
language plpgsql security definer set search_path = public
as $fn$
begin
  perform staff_tasks_private.settle_absent_day(NEW.tenant_id, NEW.student_id, NEW.session_date);
  return null;
exception when others then
  return null;
end;
$fn$;

drop trigger if exists trg_staff_task_absent_followup on public.attendance_followups;
create trigger trg_staff_task_absent_followup
  after insert or update of state, signal, slot_start on public.attendance_followups
  for each row execute function staff_tasks_private.tg_absent_followup();

-- 출결이 바뀌면(정정·삭제) 그 학생의 결석 확인만 맞춘다 — 그날 할 일이 없으면 색인 한 번 보고 끝(매일 수백 번 저장되는 표).
create or replace function staff_tasks_private.tg_absent_record()
returns trigger
language plpgsql security definer set search_path = public
as $fn$
declare
  v_row public.attendance_records;
begin
  v_row := case when tg_op = 'DELETE' then OLD else NEW end;
  if exists (select 1 from public.staff_tasks t
              where t.tenant_id = v_row.tenant_id and t.kind = 'attendance_absent_desk' and t.subject_id = v_row.student_id
                and t.cycle like v_row.session_date::text || '|%' and t.status in ('open', 'done', 'cancelled')) then
    perform staff_tasks_private.settle_absent_day(v_row.tenant_id, v_row.student_id, v_row.session_date);
  end if;
  return null;
exception when others then
  return null; -- 할 일 기록이 출결 저장을 막지 않는다.
end;
$fn$;

drop trigger if exists trg_staff_task_absent_record on public.attendance_records;
create trigger trg_staff_task_absent_record
  after insert or update of status, slot_start or delete on public.attendance_records
  for each row execute function staff_tasks_private.tg_absent_record();

-- 앱(결석 알림)이 여는 길 — 칸 목록을 받아 할 일을 열고 (학생, 넘긴 교시, 회차, 할 일)을 돌려준다.
-- 회차의 교시는 넘긴 교시와 다를 수 있다(교시 없이 저장했는데 실제 결석 줄이 교시 줄) — 앱은 넘긴 교시로 짝짓는다.
create or replace function public.staff_task_open_absences(p_tenant uuid, p_cells jsonb, p_actor uuid default null)
returns table (student_id uuid, slot text, cycle text, task_id uuid)
language plpgsql security definer set search_path = public
as $fn$
declare
  c record;
  v_id uuid;
begin
  for c in select * from jsonb_to_recordset(p_cells) as j(student_id uuid, date date, slot text) loop
    begin
      v_id := staff_tasks_private.open_absent_task(p_tenant, c.student_id, c.date, c.slot, p_actor);
    exception when others then
      v_id := null;
    end;
    if v_id is not null then
      student_id := c.student_id;
      slot := left(coalesce(c.slot, ''), 5);
      select t.cycle into cycle from public.staff_tasks t where t.id = v_id;
      task_id := v_id;
      return next;
    end if;
  end loop;
end;
$fn$;

create or replace function staff_tasks_private.sync_attendance_absent_desk(p_tenant uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $fn$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_opened int := 0;
  v_closed int := 0;
  v_id uuid;
  x record;
begin
  -- ① 저장 경로가 알림 훅을 안 거친 결석(일별 폼 등) · 훅이 실패한 결석 — 지난 7일 안 결석 칸 중 할 일이 없는 것을 연다.
  --    도입 시각 뒤에 기록된 줄만(지난 결석을 되살리지 않는다).
  for x in
    select distinct r.student_id, r.session_date, coalesce(to_char(r.slot_start, 'HH24:MI'), '') as slot
      from public.attendance_records r
     where r.tenant_id = p_tenant and r.status::text = 'absent'
       and r.session_date between v_today - 7 and v_today
       and r.recorded_at >= staff_tasks_private.kind_start('attendance_absent_desk')
       and not exists (select 1 from public.staff_tasks t where t.tenant_id = p_tenant and t.kind = 'attendance_absent_desk'
                        and t.subject_id = r.student_id
                        and t.cycle = r.session_date::text || '|' || coalesce(to_char(r.slot_start, 'HH24:MI'), ''))
  loop
    v_id := staff_tasks_private.open_absent_task(p_tenant, x.student_id, x.session_date, x.slot);
    if v_id is not null then v_opened := v_opened + 1; end if;
  end loop;
  -- ② 열린 것 · 데스크 매듭으로 닫힌 것(되돌려졌을 수 있다)을 맞춘다.
  for x in
    select t.subject_id, t.cycle from public.staff_tasks t
     where t.tenant_id = p_tenant and t.kind = 'attendance_absent_desk'
       and (t.status = 'open'
            or (t.status in ('done', 'cancelled') and t.close_reason in ('desk_settled', 'not_absent') and t.closed_at > now() - interval '8 days'))
  loop
    v_closed := v_closed + staff_tasks_private.settle_absent_task(p_tenant, x.subject_id, x.cycle);
  end loop;
  return jsonb_build_object('opened', v_opened, 'closed', v_closed);
end;
$fn$;

-- ── 30분 맞춤 = 종류별로 따로 ─────────────────────────────────────────────────
drop function if exists public.staff_tasks_sync(uuid);
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
  foreach v_kind in array coalesce(p_kinds, array['report_send_failed', 'followup_due', 'progress_anomaly', 'attendance_absent_desk']) loop
    begin
      v_one := case v_kind
        when 'report_send_failed' then staff_tasks_private.sync_report_send_failed(p_tenant)
        when 'followup_due' then staff_tasks_private.sync_followup_due(p_tenant)
        when 'progress_anomaly' then staff_tasks_private.sync_progress_anomaly(p_tenant)
        when 'attendance_absent_desk' then staff_tasks_private.sync_attendance_absent_desk(p_tenant)
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

revoke all on function public.staff_tasks_sync(uuid, text[]), public.staff_task_open_absences(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.staff_tasks_sync(uuid, text[]), public.staff_task_open_absences(uuid, jsonb, uuid) to service_role;
revoke all on all functions in schema staff_tasks_private from public, anon, authenticated;
grant execute on all functions in schema staff_tasks_private to service_role;

notify pgrst, 'reload schema';
commit;
