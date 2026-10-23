-- 0441a — 신규 콜&상담 후속 조치 할 일(원장 2026-10-22 *"후속 조치를 선택이 아닌 필수로 처리를 해서 자동적으로 이동처리 ·
-- 자동적으로 등록, 미등록으로 처리 하기 · 날짜 : 선택. 다음상담 진행 여부 등 · 후속조치일 다와가면 알람 기능"*).
--
-- 종류 하나 더: enrollment_followup — '다음 상담'으로 잡은 날이 되면 상담자(재직 중이 아니면 원장 전원)에게 할 일을 연다.
--   처리됨  = 그 상담을 등록·미등록(노쇼 포함)으로 정했다(상태가 '상담 전·상담 완료' 밖으로 나감 — 정한 사람이 처리자)
--   취소    = 다음 상담 날짜를 옮기거나 지웠다(새 날짜 날 새로 열린다) · 상담을 지웠다
--   늦음    = 그 날이 지났다(앱 `taskState` — due_at = 다음 날 0시)
-- 알림(하루 전 · 당일 · 지나면)은 앱의 아침 감지(`detectEnrollmentFollowup`)가 보내고 이 할 일을 가리킨다(당일·지남).
-- 도입한 날(2026-10-22) 이후 날짜만 — 옛 상담의 지난 후속 조치일(실측 34건, 모두 지난 날)은 열지 않는다.
--
-- 🔴 서버 전용 함수(0377a와 같다) · 할 일 기록이 상담 저장을 막지 않는다(트리거는 오류를 삼키고 30분 맞춤이 메운다).
-- 배포 순서: 앱보다 먼저여도 되고 나중이어도 된다 — 앱은 이 종류 이름만 쓰고(없으면 할 일 연결만 비고 알림은 간다) 새 칸을 읽지 않는다.
-- 되돌리기: 트리거 trg_staff_task_enrollment_followup 과 함수 넷을 지우고 public.staff_tasks_sync 를 0380a 본문으로 되돌린다.
begin;

create or replace function staff_tasks_private.enrollment_followup_start() returns date
language sql immutable as $fn$ select date '2026-10-22' $fn$;

-- 후속 조치가 아직 남은 상태 = 상담 전(대기·예약) · 상담 완료(상담·AI 완료). 등록·미등록·노쇼는 정해진 것.
create or replace function staff_tasks_private.enrollment_followup_active(p_outcome text) returns boolean
language sql immutable as $fn$ select p_outcome in ('pending', 'scheduled', 'consulted', 'ai_done') $fn$;

create or replace function staff_tasks_private.open_enrollment_followup_task(p_consultation uuid, p_actor uuid default null)
returns uuid
language plpgsql security definer set search_path = public
as $fn$
declare
  c record;
  v_assignees uuid[];
begin
  select ec.id, ec.tenant_id, ec.prospect_name, ec.consultant_id, ec.follow_up_date, ec.outcome::text as outcome
    into c from public.enrollment_consultations ec where ec.id = p_consultation;
  if c.id is null or c.follow_up_date is null
     or not staff_tasks_private.enrollment_followup_active(c.outcome)
     or c.follow_up_date > (now() at time zone 'Asia/Seoul')::date
     or c.follow_up_date < staff_tasks_private.enrollment_followup_start() then
    return null;
  end if;
  -- 맡은 사람 = 알림과 같다(상담자가 재직 중이면 그 사람, 아니면 원장 전원). 아무도 없으면 열지 않는다.
  select coalesce(
    (select array[u.id] from public.users u where u.id = c.consultant_id and u.tenant_id = c.tenant_id and u.status = 'active'),
    staff_tasks_private.master_ids(c.tenant_id)) into v_assignees;
  if coalesce(cardinality(v_assignees), 0) = 0 then
    return null;
  end if;
  return staff_tasks_private.open_task(
    c.tenant_id, 'enrollment_followup', c.id, c.follow_up_date::text,
    '콜&상담 후속 조치',
    coalesce(nullif(btrim(c.prospect_name), ''), '상담') || ' · 다음 상담 ' || to_char(c.follow_up_date, 'MM-DD'),
    '/enrollment/' || c.id::text,
    ((c.follow_up_date + 1)::timestamp at time zone 'Asia/Seoul'),
    v_assignees, p_actor);
end;
$fn$;

create or replace function staff_tasks_private.tg_enrollment_followup_task()
returns trigger
language plpgsql security definer set search_path = public
as $fn$
declare
  v_actor uuid := auth.uid();
  v_was boolean;
  v_now boolean;
begin
  if tg_op = 'DELETE' then
    perform staff_tasks_private.close_task(OLD.tenant_id, 'enrollment_followup', OLD.id, null, 'cancelled', 'deleted', v_actor);
    return null;
  end if;
  v_was := staff_tasks_private.enrollment_followup_active(OLD.outcome::text);
  v_now := staff_tasks_private.enrollment_followup_active(NEW.outcome::text);
  if v_was and not v_now then
    -- 등록·미등록으로 정했다 = 후속 조치를 한 것(정한 사람이 처리자). 상담 완료 안에서 'AI 완료'로 바뀌는 것은 처리가 아니다.
    perform staff_tasks_private.close_task(NEW.tenant_id, 'enrollment_followup', NEW.id, null, 'done', 'decided', v_actor);
    return null;
  end if;
  if NEW.follow_up_date is distinct from OLD.follow_up_date then
    -- 날짜를 옮기거나 지웠다 — 옛 회차는 취소(새 날짜 날 새로 연다).
    perform staff_tasks_private.close_task(NEW.tenant_id, 'enrollment_followup', NEW.id, coalesce(OLD.follow_up_date::text, ''), 'cancelled',
      case when NEW.follow_up_date is null then 'cleared' else 'rescheduled' end, v_actor);
  end if;
  if v_now and (
       NEW.follow_up_date is distinct from OLD.follow_up_date
       or not v_was
       or (NEW.consultant_id is distinct from OLD.consultant_id
           and exists (select 1 from public.staff_tasks t where t.tenant_id = NEW.tenant_id and t.kind = 'enrollment_followup'
                        and t.subject_id = NEW.id and t.status = 'open'))) then
    -- 오늘 이하로 날짜를 잡았거나 · 미등록에서 다시 상담으로 돌아왔거나 · 상담자가 바뀌었다 — 그 회차를 (다시) 연다. 날짜 전이면 아무 일 없다.
    perform staff_tasks_private.open_enrollment_followup_task(NEW.id, v_actor);
  end if;
  return null;
exception when others then
  return null; -- 할 일 기록이 상담 저장을 막지 않는다(30분 맞춤이 메운다).
end;
$fn$;

drop trigger if exists trg_staff_task_enrollment_followup on public.enrollment_consultations;
create trigger trg_staff_task_enrollment_followup
  after update of outcome, follow_up_date, consultant_id or delete on public.enrollment_consultations
  for each row execute function staff_tasks_private.tg_enrollment_followup_task();

-- 30분 맞춤 — 날이 된 후속 조치를 열고(트리거는 날짜를 저장한 순간에만 돈다 — 미래 날짜는 그날 여기서 열린다), 끝난 것을 닫는다.
create or replace function staff_tasks_private.sync_enrollment_followup(p_tenant uuid)
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
    select ec.id from public.enrollment_consultations ec
     where ec.tenant_id = p_tenant and ec.follow_up_date is not null
       and ec.follow_up_date <= v_today and ec.follow_up_date >= staff_tasks_private.enrollment_followup_start()
       and staff_tasks_private.enrollment_followup_active(ec.outcome::text)
       and not exists (select 1 from public.staff_tasks t where t.tenant_id = p_tenant and t.kind = 'enrollment_followup'
                        and t.subject_id = ec.id and t.cycle = ec.follow_up_date::text)
  loop
    v_id := staff_tasks_private.open_enrollment_followup_task(x.id);
    if v_id is not null then v_opened := v_opened + 1; end if;
  end loop;

  for x in
    select t.subject_id, t.cycle, ec.id as cid, ec.outcome::text as outcome, ec.follow_up_date
      from public.staff_tasks t
      left join public.enrollment_consultations ec on ec.id = t.subject_id and ec.tenant_id = t.tenant_id
     where t.tenant_id = p_tenant and t.kind = 'enrollment_followup' and t.status = 'open'
  loop
    if x.cid is null then
      v_closed := v_closed + staff_tasks_private.close_task(p_tenant, 'enrollment_followup', x.subject_id, x.cycle, 'cancelled', 'deleted', null);
    elsif not staff_tasks_private.enrollment_followup_active(x.outcome) then
      v_closed := v_closed + staff_tasks_private.close_task(p_tenant, 'enrollment_followup', x.subject_id, x.cycle, 'done', 'decided', null);
    elsif x.follow_up_date is null or x.follow_up_date::text <> x.cycle then
      v_closed := v_closed + staff_tasks_private.close_task(p_tenant, 'enrollment_followup', x.subject_id, x.cycle, 'cancelled', 'rescheduled', null);
    end if;
  end loop;
  return jsonb_build_object('opened', v_opened, 'closed', v_closed);
end;
$fn$;

-- ── 30분 맞춤 묶음 = 0380a 본문 + 콜&상담 후속 조치 ──────────────────────────────
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
                                                   'video_upload_check', 'video_unassigned', 'unsent_report',
                                                   'approval_turn', 'withdrawal_step', 'help_question', 'enrollment_followup']) loop
    begin
      v_one := case v_kind
        when 'report_send_failed' then staff_tasks_private.sync_report_send_failed(p_tenant)
        when 'followup_due' then staff_tasks_private.sync_followup_due(p_tenant)
        when 'progress_anomaly' then staff_tasks_private.sync_progress_anomaly(p_tenant)
        when 'attendance_absent_desk' then staff_tasks_private.sync_attendance_absent_desk(p_tenant)
        when 'video_upload_check' then staff_tasks_private.sync_video_upload_check(p_tenant)
        when 'video_unassigned' then staff_tasks_private.sync_video_unassigned(p_tenant)
        when 'unsent_report' then staff_tasks_private.sync_unsent_report(p_tenant)
        when 'approval_turn' then staff_tasks_private.sync_approval_turn(p_tenant)
        when 'withdrawal_step' then staff_tasks_private.sync_withdrawal_step(p_tenant)
        when 'help_question' then staff_tasks_private.sync_help_question(p_tenant)
        when 'enrollment_followup' then staff_tasks_private.sync_enrollment_followup(p_tenant)
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

revoke all on all functions in schema staff_tasks_private from public, anon, authenticated;
grant execute on all functions in schema staff_tasks_private to service_role;

notify pgrst, 'reload schema';
commit;
