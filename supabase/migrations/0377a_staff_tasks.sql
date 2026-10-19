-- 0377a — 업무 처리 확인(원장 2026-10-19 *"관리자가 괜히 직원들에게 이거했나? 이거했나? 안물어봐도 시스템적으로 체크되도록"*).
--
-- 알림과 따로 '할 일' 원장을 둔다 — 알림은 묶이고(미발송 보고서 여러 건 = 알림 하나) 고쳐지고(영상 미배정은 제목·시각을 갱신)
-- 읽은 뒤 90일이면 지워진다(prune.ts). 그 위에 처리 기록을 얹으면 기록도 함께 사라진다.
--   staff_tasks           할 일 한 건(종류 × 대상 × 회차). 끝났는지는 **원래 기록의 사실**로 판정한다 — 사람이 누르는 버튼이 아니다.
--   staff_task_assignees  맡은 사람(여럿이면 함께 맡은 일 — 한 사람이 처리하면 닫히고, 처리한 사람은 closed_by 한 명)
--   staff_task_events     변경 이력(열림 · 다시 열림 · 재발송 요청 · 처리 · 취소 · 기한 지남)
--   notifications.task_id 그 할 일을 알린 알림(벨이 상태를 붙인다)
--
-- 1단계 종류 둘(도입한 날부터 생긴 것만 — 지난 알림을 거슬러 바꾸지 않는다):
--   report_send_failed  수업 보고서 발송 실패 → 그 보고서가 실제로 나가면(classnote_status = 'success') 처리됨.
--                       재발송 요청(queued)은 처리가 아니다 · 회수·삭제는 취소 · 재발송 기한(보고서 날 포함 7일)이 지나면 기한 지남.
--   followup_due        상담 후속조치 기한 → 후속조치 완료 체크(follow_up_done)로 처리됨(체크한 사람이 처리자).
--                       체크를 풀면 다시 열림 · 기한을 옮기면 그 회차는 취소(새 기한 날 새로 열린다) · 상담 삭제는 취소.
-- 닫는 길 둘: ① 원래 기록이 바뀌는 순간(트리거) ② 30분마다 다시 맞춤(`staff_tasks_sync` — 트리거·알림이 빠진 것도 메운다).
--
-- 🔴 서버 전용(정책 0개 · 0374a·0376a와 같은 방식): 앱이 사람을 확인한 뒤 관리 키로 읽는다(맡은 사람 = 내 것 ·
--    원장과 지정한 사람 = 전부). 화면에서 처리 상태를 직접 바꾸는 길은 없다.
-- 배포 순서: **앱보다 먼저**(#95) — 벨 목록이 notifications.task_id를 읽는다(앱은 칸이 없어도 목록을 비우지 않게 따로 읽는다).
-- 되돌리기: 트리거 둘 · 함수 · 표 셋 · notifications.task_id 를 지우고 notify_report_send_failed 를 0306a 본문으로 되돌린다.
begin;

create schema if not exists staff_tasks_private;
revoke all on schema staff_tasks_private from public, anon, authenticated;
grant usage on schema staff_tasks_private to service_role;

create table if not exists public.staff_tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null check (kind ~ '^[a-z_]+$'),
  subject_id uuid not null,
  cycle text not null default '',
  title text not null,
  detail text,
  link text,
  status text not null default 'open' check (status in ('open', 'done', 'cancelled', 'expired')),
  opened_at timestamptz not null default now(),
  due_at timestamptz,
  closed_at timestamptz,
  closed_by uuid references public.users(id) on delete set null,
  close_reason text,
  -- 마지막으로 손댄 사람(재발송 요청 등) — 발송 성공은 연동 PC가 찍어서 그때의 로그인 사용자가 없다. 처리자로 쓴다.
  last_actor_id uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint staff_tasks_subject_key unique (tenant_id, kind, subject_id, cycle)
);
create index if not exists staff_tasks_open_idx on public.staff_tasks (tenant_id, due_at) where status = 'open';
create index if not exists staff_tasks_opened_idx on public.staff_tasks (tenant_id, opened_at desc);
create index if not exists staff_tasks_closed_by_idx on public.staff_tasks (closed_by);
create index if not exists staff_tasks_last_actor_idx on public.staff_tasks (last_actor_id);

create table if not exists public.staff_task_assignees (
  task_id uuid not null references public.staff_tasks(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (task_id, user_id)
);
create index if not exists staff_task_assignees_user_idx on public.staff_task_assignees (tenant_id, user_id);
create index if not exists staff_task_assignees_user_fk_idx on public.staff_task_assignees (user_id);

create table if not exists public.staff_task_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  task_id uuid not null references public.staff_tasks(id) on delete cascade,
  at timestamptz not null default now(),
  event text not null check (event in ('opened', 'reopened', 'assigned', 'retry_requested', 'failed_again', 'done', 'cancelled', 'expired')),
  actor_id uuid references public.users(id) on delete set null,
  note text
);
create index if not exists staff_task_events_task_idx on public.staff_task_events (task_id, at);
create index if not exists staff_task_events_actor_idx on public.staff_task_events (actor_id);

alter table public.staff_tasks enable row level security;
alter table public.staff_task_assignees enable row level security;
alter table public.staff_task_events enable row level security;
revoke all on public.staff_tasks, public.staff_task_assignees, public.staff_task_events from public, anon, authenticated;
grant all on public.staff_tasks, public.staff_task_assignees, public.staff_task_events to service_role;

alter table public.notifications add column if not exists task_id uuid references public.staff_tasks(id) on delete set null;
create index if not exists notifications_task_idx on public.notifications (task_id) where task_id is not null;

-- ── 공용: 열기 · 닫기 ────────────────────────────────────────────────────────
-- 열기 = 없으면 만들고, 닫혀 있으면 다시 연다(이력 'reopened'). 열려 있으면 글만 새로 맞춘다(늦음 기준은 그대로). 맡은 사람은 넘긴 명단으로 맞춘다.
create or replace function staff_tasks_private.open_task(
  p_tenant uuid, p_kind text, p_subject uuid, p_cycle text,
  p_title text, p_detail text, p_link text, p_due timestamptz, p_assignees uuid[], p_actor uuid default null
) returns uuid
language plpgsql security definer set search_path = public
as $fn$
declare
  v_id uuid;
  v_status text;
  v_new uuid[];
begin
  select id, status into v_id, v_status from public.staff_tasks
   where tenant_id = p_tenant and kind = p_kind and subject_id = p_subject and cycle = p_cycle
   for update;
  if v_id is null then
    insert into public.staff_tasks (tenant_id, kind, subject_id, cycle, title, detail, link, due_at)
    values (p_tenant, p_kind, p_subject, p_cycle, p_title, p_detail, p_link, p_due)
    on conflict (tenant_id, kind, subject_id, cycle) do nothing
    returning id into v_id;
    if v_id is null then
      -- 같은 순간에 다른 거래가 만들었다 — 그 행을 쓴다.
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
    -- 열려 있는 일은 글만 새로 맞춘다 — 늦음 기준(due_at)은 처음 연 때 그대로(재발송 뒤 또 실패해도 기준이 뒤로 밀리지 않게).
    update public.staff_tasks
       set title = p_title, detail = p_detail, link = p_link, updated_at = now()
     where id = v_id and (title, detail, link) is distinct from (p_title, p_detail, p_link);
  end if;

  -- 맡은 사람 = 같은 학원 사람만. 빈 명단이면 그대로 둔다(아무도 안 맡은 일을 만들지 않게 — 부르는 쪽이 원장 폴백을 준다).
  select coalesce(array_agg(u.id), '{}') into v_new
    from public.users u where u.tenant_id = p_tenant and u.id = any(coalesce(p_assignees, '{}'));
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

-- 닫기 = 열린(처리됨이면 기한 지남까지) 회차를 닫는다. p_cycle이 null이면 그 대상의 모든 회차. 닫은 건수를 돌려준다.
create or replace function staff_tasks_private.close_task(
  p_tenant uuid, p_kind text, p_subject uuid, p_cycle text, p_status text, p_reason text, p_actor uuid
) returns int
language plpgsql security definer set search_path = public
as $fn$
declare
  v_n int;
begin
  with closed as (
    update public.staff_tasks t
       set status = p_status, closed_at = now(), close_reason = p_reason, updated_at = now(),
           closed_by = case when p_status = 'done' then coalesce(p_actor, t.last_actor_id) else p_actor end
     where t.tenant_id = p_tenant and t.kind = p_kind and t.subject_id = p_subject
       and (p_cycle is null or t.cycle = p_cycle)
       and (t.status = 'open' or (p_status = 'done' and t.status = 'expired'))
    returning t.id, t.closed_by
  )
  insert into public.staff_task_events (tenant_id, task_id, event, actor_id, note)
  select p_tenant, c.id, p_status, c.closed_by, p_reason from closed c;
  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

-- ── 보고서 발송 실패 ───────────────────────────────────────────────────────────
-- 맡은 사람 = 알림과 같은 규칙(반 담당 → 보고서에 적힌 이름의 재직 강사 → 원장 전원).
create or replace function staff_tasks_private.report_assignees(p_tenant uuid, p_class uuid, p_teacher_name text)
returns uuid[]
language sql stable security definer set search_path = public
as $fn$
  select coalesce(
    (select array[c.teacher_id] from public.classes c
      where c.id = p_class and c.tenant_id = p_tenant and c.teacher_id is not null
        and exists (select 1 from public.users tu where tu.id = c.teacher_id and tu.tenant_id = p_tenant)),
    (select array[u.id] from public.users u
      where u.tenant_id = p_tenant and u.status = 'active' and coalesce(p_teacher_name, '') <> '' and u.display_name = p_teacher_name
      limit 1),
    (select array_agg(u.id) from public.users u where u.tenant_id = p_tenant and u.status = 'active' and u.system_role = 'master'),
    '{}'::uuid[]);
$fn$;

-- 보고서 하나의 실패 할 일을 연다(테스트 학생은 열지 않는다 — 알림과 같다).
create or replace function staff_tasks_private.open_report_task(p_report uuid, p_hint text default null)
returns uuid
language plpgsql security definer set search_path = public
as $fn$
declare
  r record;
  v_student text;
  v_hint text;
  v_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  select lr.id, lr.tenant_id, lr.student_id, lr.class_id, lr.teacher_name, lr.report_date, lr.classnote_error
    into r from public.lesson_reports lr where lr.id = p_report;
  if r.id is null then return null; end if;
  if exists (select 1 from public.students s where s.id = r.student_id and s.tenant_id = r.tenant_id and s.is_test) then
    return null;
  end if;
  select s.name into v_student from public.students s where s.id = r.student_id and s.tenant_id = r.tenant_id;
  v_hint := coalesce(p_hint, case
    when coalesce(r.classnote_error, '') ilike '%학생 없음%' then '학부모가 ClassNote 알림장에 연결되어 있지 않습니다'
    when coalesce(r.classnote_error, '') = '' then '사유가 기록되지 않았습니다'
    else r.classnote_error end);
  return staff_tasks_private.open_task(
    r.tenant_id, 'report_send_failed', r.id, '',
    '수업 보고서 발송 실패',
    coalesce(v_student, '학생') || ' · ' || to_char(r.report_date, 'MM-DD') || ' — ' || v_hint,
    '/lesson-reports',
    -- 늦음 = 실패한 다음 날이 끝날 때까지 못 보냄
    ((v_today + 2)::timestamp at time zone 'Asia/Seoul'),
    staff_tasks_private.report_assignees(r.tenant_id, r.class_id, r.teacher_name));
end;
$fn$;

-- 발송 실패 알림(0143a → 0153a → 0306a 본문 그대로) + 할 일을 열고 알림에 잇는다.
-- 할 일은 따로 감싼다 — 할 일이 실패해도 알림은 나간다(알림 실패도 발송 상태 기록을 막지 않는 0143a 원칙 그대로).
create or replace function public.notify_report_send_failed()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_recipient uuid;
  v_student text;
  v_hint text;
  v_task uuid;
begin
  -- 🔴 테스트 학생(0153a)은 알리지 않는다 — 학부모가 없어 실패가 정상이라 매번 오탐이 된다.
  if exists (select 1 from public.students s where s.id = NEW.student_id and s.tenant_id = NEW.tenant_id and s.is_test) then
    return NEW;
  end if;

  begin
    v_task := staff_tasks_private.open_report_task(NEW.id);
    if v_task is not null and OLD.classnote_status in ('queued', 'processing') then
      insert into public.staff_task_events (tenant_id, task_id, event)
      select NEW.tenant_id, v_task, 'failed_again'
       where exists (select 1 from public.staff_task_events e where e.task_id = v_task and e.event = 'retry_requested');
    end if;
  exception when others then
    v_task := null;
  end;

  -- 수신자 ① 반 담당 강사
  select c.teacher_id into v_recipient
  from public.classes c
  where c.id = NEW.class_id and c.tenant_id = NEW.tenant_id and c.teacher_id is not null
    and exists (select 1 from public.users tu where tu.id = c.teacher_id and tu.tenant_id = NEW.tenant_id);

  -- 수신자 ② 보고서에 적힌 강사 이름과 일치하는 재직 강사(반 연결이 끊긴 옛 행 대비)
  if v_recipient is null and coalesce(NEW.teacher_name, '') <> '' then
    select u.id into v_recipient
    from public.users u
    where u.tenant_id = NEW.tenant_id
      and u.status = 'active'
      and u.display_name = NEW.teacher_name
    limit 1;
  end if;

  select s.name into v_student from public.students s where s.id = NEW.student_id and s.tenant_id = NEW.tenant_id;

  v_hint := case
    when coalesce(NEW.classnote_error, '') ilike '%학생 없음%'
      then '학부모가 ClassNote 알림장에 연결되어 있지 않습니다 — 학부모를 초대한 뒤 다시 발송하세요.'
    when coalesce(NEW.classnote_error, '') = '' then '사유가 기록되지 않았습니다 — 발송 콘솔에서 확인하세요.'
    else NEW.classnote_error
  end;

  if v_recipient is null then
    insert into public.notifications (tenant_id, recipient_id, type, title, body, link, actor_id, task_id)
    select NEW.tenant_id, u.id, 'report_send_failed', '수업 보고서 발송 실패',
           coalesce(v_student, '학생') || ' · ' || to_char(NEW.report_date, 'MM-DD') || ' — ' || v_hint,
           '/lesson-reports', null, v_task
    from public.users u
    where u.tenant_id = NEW.tenant_id and u.status = 'active' and u.system_role = 'master';
  else
    insert into public.notifications (tenant_id, recipient_id, type, title, body, link, actor_id, task_id)
    values (NEW.tenant_id, v_recipient, 'report_send_failed', '수업 보고서 발송 실패',
            coalesce(v_student, '학생') || ' · ' || to_char(NEW.report_date, 'MM-DD') || ' — ' || v_hint,
            '/lesson-reports', null, v_task);
  end if;

  return NEW;
exception
  -- best-effort — 알림 insert가 실패해도 발송 상태 기록(본 UPDATE)을 막지 않는다(0143a 원칙 유지).
  when others then
    return NEW;
end;
$fn$;

-- 보고서가 바뀌는 순간 닫는다 — 실패 할 일이 있는 보고서만 일한다(없으면 색인 한 번 보고 끝).
create or replace function staff_tasks_private.tg_report_task()
returns trigger
language plpgsql security definer set search_path = public
as $fn$
declare
  v_row public.lesson_reports;
  v_actor uuid := auth.uid();
begin
  v_row := case when tg_op = 'DELETE' then OLD else NEW end;
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
      -- 재발송 요청 = 처리가 아니다(나가야 처리). 누가 요청했는지만 남긴다 — 나가면 그 사람이 처리자.
      update public.staff_tasks set last_actor_id = coalesce(v_actor, last_actor_id), updated_at = now()
       where tenant_id = NEW.tenant_id and kind = 'report_send_failed' and subject_id = NEW.id and status = 'open';
      insert into public.staff_task_events (tenant_id, task_id, event, actor_id)
      select NEW.tenant_id, t.id, 'retry_requested', v_actor from public.staff_tasks t
       where t.tenant_id = NEW.tenant_id and t.kind = 'report_send_failed' and t.subject_id = NEW.id and t.status = 'open';
    end if;
  end if;
  return null;
exception when others then
  return null; -- 할 일 기록이 보고서 저장을 막지 않는다(30분 맞춤이 메운다).
end;
$fn$;

drop trigger if exists trg_staff_task_report on public.lesson_reports;
create trigger trg_staff_task_report
  after update of classnote_status, revoked_at or delete on public.lesson_reports
  for each row execute function staff_tasks_private.tg_report_task();

-- ── 상담 후속조치 ─────────────────────────────────────────────────────────────
-- 도입한 날(이 날 이후 기한부터). 30분 맞춤과 트리거가 같은 값을 본다.
create or replace function staff_tasks_private.followup_start() returns date
language sql immutable as $fn$ select date '2026-10-20' $fn$;

create or replace function staff_tasks_private.open_followup_task(p_consultation uuid, p_actor uuid default null)
returns uuid
language plpgsql security definer set search_path = public
as $fn$
declare
  c record;
  v_student text;
  v_assignees uuid[];
begin
  select sc.id, sc.tenant_id, sc.student_id, sc.counselor_id, sc.follow_up_date, sc.follow_up_done
    into c from public.student_consultations sc where sc.id = p_consultation;
  if c.id is null or c.follow_up_done or c.follow_up_date is null
     or c.follow_up_date > (now() at time zone 'Asia/Seoul')::date
     or c.follow_up_date < staff_tasks_private.followup_start() then
    return null;
  end if;
  select s.name into v_student from public.students s where s.id = c.student_id and s.tenant_id = c.tenant_id;
  -- 맡은 사람 = 알림과 같다(담당 상담사가 재직 중이면 그 사람, 아니면 원장 전원).
  select coalesce(
    (select array[u.id] from public.users u where u.id = c.counselor_id and u.tenant_id = c.tenant_id and u.status = 'active'),
    (select array_agg(u.id) from public.users u where u.tenant_id = c.tenant_id and u.status = 'active' and u.system_role = 'master'),
    '{}') into v_assignees;
  return staff_tasks_private.open_task(
    c.tenant_id, 'followup_due', c.id, c.follow_up_date::text,
    '상담 후속조치',
    coalesce(v_student, '학생') || ' · 기한 ' || to_char(c.follow_up_date, 'MM-DD'),
    '/consultations/' || c.id::text,
    ((c.follow_up_date + 1)::timestamp at time zone 'Asia/Seoul'),
    v_assignees, p_actor);
end;
$fn$;

create or replace function staff_tasks_private.tg_followup_task()
returns trigger
language plpgsql security definer set search_path = public
as $fn$
declare
  v_actor uuid := auth.uid();
begin
  if tg_op = 'DELETE' then
    perform staff_tasks_private.close_task(OLD.tenant_id, 'followup_due', OLD.id, null, 'cancelled', 'deleted', v_actor);
    return null;
  end if;
  if NEW.follow_up_done and not OLD.follow_up_done then
    perform staff_tasks_private.close_task(NEW.tenant_id, 'followup_due', NEW.id, null, 'done', 'followup_done', v_actor);
    return null;
  end if;
  if NEW.follow_up_date is distinct from OLD.follow_up_date then
    -- 기한을 옮기거나 지웠다 — 옛 회차는 취소(새 기한 날 새로 연다).
    perform staff_tasks_private.close_task(NEW.tenant_id, 'followup_due', NEW.id, coalesce(OLD.follow_up_date::text, ''), 'cancelled',
      case when NEW.follow_up_date is null then 'cleared' else 'rescheduled' end, v_actor);
  end if;
  if not NEW.follow_up_done then
    -- 체크를 풀었거나 · 오늘 이하로 기한을 옮겼거나 · 담당 상담사가 바뀌었다 — 그 회차를 (다시) 연다. 기한 전이면 아무 일 없다.
    if (OLD.follow_up_done and not NEW.follow_up_done)
       or NEW.follow_up_date is distinct from OLD.follow_up_date
       or (NEW.counselor_id is distinct from OLD.counselor_id
           and exists (select 1 from public.staff_tasks t where t.tenant_id = NEW.tenant_id and t.kind = 'followup_due'
                        and t.subject_id = NEW.id and t.status = 'open')) then
      perform staff_tasks_private.open_followup_task(NEW.id, v_actor);
    end if;
  end if;
  return null;
exception when others then
  return null; -- 할 일 기록이 상담 저장을 막지 않는다(30분 맞춤이 메운다).
end;
$fn$;

drop trigger if exists trg_staff_task_followup on public.student_consultations;
create trigger trg_staff_task_followup
  after update of follow_up_done, follow_up_date, counselor_id or delete on public.student_consultations
  for each row execute function staff_tasks_private.tg_followup_task();

-- ── 30분 맞춤 ────────────────────────────────────────────────────────────────
-- 원래 기록과 다시 맞춘다: 빠진 할 일을 열고(기한 날이 된 후속조치 · 트리거가 놓친 실패), 이미 끝난 일을 닫는다.
create or replace function public.staff_tasks_sync(p_tenant uuid)
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
  -- 1) 보고서 발송 실패 — 아직 재발송 기한 안(또는 기한 예외)인데 열린 할 일이 없는 실패. 도입 시각 뒤에 실패한 것만.
  for x in
    select lr.id from public.lesson_reports lr
     where lr.tenant_id = p_tenant and lr.classnote_status = 'failed' and lr.revoked_at is null
       and coalesce(lr.classnote_processing_at, lr.classnote_queued_at) >= timestamptz '2026-10-20 00:00+09'
       and (lr.report_date >= v_today - 6 or lr.classnote_deadline_exempt_at is not null)
       and not exists (select 1 from public.staff_tasks t where t.tenant_id = p_tenant and t.kind = 'report_send_failed'
                        and t.subject_id = lr.id and t.status = 'open')
       and not exists (select 1 from public.students s where s.id = lr.student_id and s.tenant_id = p_tenant and s.is_test)
  loop
    v_id := staff_tasks_private.open_report_task(x.id);
    if v_id is not null then v_opened := v_opened + 1; end if;
  end loop;

  -- 2) 보고서 할 일 닫기 — 나갔으면 처리됨 · 회수·삭제는 취소 · 기한이 지났으면 기한 지남.
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

  -- 3) 상담 후속조치 — 기한 날이 됐는데(또는 지났는데) 그 회차 할 일이 아직 없는 것. 이미 닫힌 회차는 다시 열지 않는다(체크 풀기는 트리거가).
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

  -- 4) 후속조치 할 일 닫기 — 완료 체크 · 기한 이동/삭제 · 상담 삭제.
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

-- 사람별 열린 할 일 · 그중 늦음(운영실 카드 · 벨 — 행을 끌어와 세지 않는다, B2).
create or replace function public.staff_task_counts(p_tenant uuid, p_user uuid default null)
returns table (user_id uuid, open_count int, late_count int)
language sql stable security definer set search_path = public
as $fn$
  select a.user_id, count(*)::int, count(*) filter (where t.due_at < now())::int
    from public.staff_tasks t
    join public.staff_task_assignees a on a.task_id = t.id
   where t.tenant_id = p_tenant and t.status = 'open' and (p_user is null or a.user_id = p_user)
   group by a.user_id;
$fn$;

revoke all on function public.staff_tasks_sync(uuid), public.staff_task_counts(uuid, uuid) from public, anon, authenticated;
grant execute on function public.staff_tasks_sync(uuid), public.staff_task_counts(uuid, uuid) to service_role;
revoke all on all functions in schema staff_tasks_private from public, anon, authenticated;
grant execute on all functions in schema staff_tasks_private to service_role;

commit;
