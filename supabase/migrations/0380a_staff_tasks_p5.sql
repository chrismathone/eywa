-- 0380a — 업무 처리 확인 5단계(0379a 위에): '내 차례'인 일 셋 — 전자결재 차례 · 퇴원보고서 단계 · 도움말 질문.
--
--   approval_turn       전자결재 문서가 내 결재 차례에 옴 → 내가 승인·반려·전결하면 처리됨(누른 사람). 후결로 넘겨진 칸은
--                       '후결 확인'을 하면 처리됨. 문서가 취소되거나 내 차례가 전결로 생략되면 취소. 대상 = 결재 단계(approval_steps.id).
--                       맡은 사람 = 그 단계의 결재자.
--   withdrawal_step     퇴원보고서(실험실): 작성 차례(담임 · 요청·보완 요청 상태) · 관리자 승인 차례 · 원장 승인 차례 →
--                       그 사람이 제출·승인하면 처리됨. 사람마다 한 건(여럿이 모두 승인해야 하는 단계라 함께 맡지 않는다).
--                       단계가 바뀌어 그 차례가 없어지면(보완 요청·취소) 취소. 대상 = 보고서, 회차 = 단계:사람
--                       (보고서는 저장마다 개정 번호가 오르므로 회차에 넣지 않는다 — 보완 요청 뒤 같은 차례가 오면 다시 열린다).
--   help_question       도움말 게시판 새 질문 → 답변이 달리거나 답변 완료·닫힘이 되면 처리됨(첫 답변자). 질문이 지워지면 취소.
--                       맡은 사람 = 알림과 같다(원장·관리자 — 질문한 사람 제외, 함께 맡음).
--
-- 알림 연결: 이 셋은 알림을 앱·다른 함수가 따로 넣는다 → 알림이 들어올 때 같은 링크·같은 받는 사람의 열린 할 일에 잇는다(앞 트리거).
-- 🔴 신규생 90일 체크리스트는 이번에 넣지 않는다 — 맡은 사람(담임·상담사)과 첫 수업일이 저장값이 아니라 화면 판정이라,
--    DB가 따로 정하면 화면과 다른 사람에게 재촉한다.
-- 배포 순서: 앱보다 먼저(#95). 되돌리기: 트리거 넷 · 함수 · 0379a의 staff_tasks_sync 본문.
begin;

-- ── 전자결재 차례 ────────────────────────────────────────────────────────────
-- 문서 하나의 결재 차례 할 일을 지금 사실과 맞춘다(지금 차례 = 열기 · 결정 = 처리됨 · 그 밖 = 취소).
create or replace function staff_tasks_private.approval_sync_doc(p_doc uuid)
returns int
language plpgsql security definer set search_path = public
as $fn$
declare
  d record;
  s record;
  v_n int := 0;
  v_drafter text;
  v_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  select ad.id, ad.tenant_id, ad.title, ad.status, ad.current_step, ad.submitted_at, ad.created_at, ad.drafter_id into d
    from public.approval_documents ad where ad.id = p_doc;
  if d.id is null then return 0; end if;
  select u.display_name into v_drafter from public.users u where u.id = d.drafter_id and u.tenant_id = d.tenant_id;
  for s in
    select st.id, st.step_no, st.approver_id, st.decision, st.acted_by from public.approval_steps st
     where st.document_id = d.id and st.tenant_id = d.tenant_id
  loop
    -- 결정(0216a 포함): 승인 · 반려 · 전결(그 칸에서 종결) · 후결 확인 = 처리됨 · 전결로 생략 = 취소.
    if s.decision in ('approved', 'rejected', 'final', 'post_approved') then
      v_n := v_n + staff_tasks_private.close_task(d.tenant_id, 'approval_turn', s.id, null, 'done', 'approval_decided',
        coalesce(s.acted_by, s.approver_id));
    elsif s.decision = 'deferred' and d.status <> 'canceled'
          and coalesce(d.submitted_at, d.created_at) >= staff_tasks_private.kind_start('approval_turn') then
      -- 후결로 넘겨진 칸 = 나중에 '후결 확인'을 해야 하는 사람의 일(문서가 끝난 뒤에도).
      perform staff_tasks_private.open_task(
        d.tenant_id, 'approval_turn', s.id, '',
        '전자결재 후결 확인',
        coalesce(d.title, '결재 문서') || coalesce(' · 기안 ' || v_drafter, ''),
        '/approvals/' || d.id::text,
        ((v_today + 2)::timestamp at time zone 'Asia/Seoul'),
        array[s.approver_id], null);
    elsif s.decision = 'pending' and d.status = 'pending' and s.step_no = d.current_step
          and coalesce(d.submitted_at, d.created_at) >= staff_tasks_private.kind_start('approval_turn') then
      perform staff_tasks_private.open_task(
        d.tenant_id, 'approval_turn', s.id, '',
        '전자결재 차례',
        coalesce(d.title, '결재 문서') || coalesce(' · 기안 ' || v_drafter, ''),
        '/approvals/' || d.id::text,
        ((v_today + 2)::timestamp at time zone 'Asia/Seoul'),
        array[s.approver_id], null);
    else
      v_n := v_n + staff_tasks_private.close_task(d.tenant_id, 'approval_turn', s.id, null, 'cancelled',
        case when d.status = 'canceled' then 'document_canceled' else 'turn_skipped' end, null);
    end if;
  end loop;
  return v_n;
end;
$fn$;

create or replace function staff_tasks_private.tg_approval_task()
returns trigger
language plpgsql security definer set search_path = public
as $fn$
begin
  if tg_table_name = 'approval_documents' then
    perform staff_tasks_private.approval_sync_doc(NEW.id);
  else
    perform staff_tasks_private.approval_sync_doc(NEW.document_id);
  end if;
  return null;
exception when others then
  return null; -- 할 일 기록이 결재를 막지 않는다(30분 맞춤이 메운다).
end;
$fn$;

drop trigger if exists trg_staff_task_approval_doc on public.approval_documents;
create trigger trg_staff_task_approval_doc
  after insert or update of status, current_step on public.approval_documents
  for each row execute function staff_tasks_private.tg_approval_task();
drop trigger if exists trg_staff_task_approval_step on public.approval_steps;
create trigger trg_staff_task_approval_step
  after insert or update of decision, approver_id on public.approval_steps
  for each row execute function staff_tasks_private.tg_approval_task();

create or replace function staff_tasks_private.sync_approval_turn(p_tenant uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $fn$
declare
  v_closed int := 0;
  x record;
begin
  for x in
    select distinct d.id from public.approval_documents d
     where d.tenant_id = p_tenant and (
       ((d.status = 'pending' or exists (select 1 from public.approval_steps st where st.document_id = d.id and st.decision = 'deferred'))
        and coalesce(d.submitted_at, d.created_at) >= staff_tasks_private.kind_start('approval_turn'))
       or exists (select 1 from public.approval_steps st join public.staff_tasks t on t.subject_id = st.id
                   and t.tenant_id = p_tenant and t.kind = 'approval_turn' and t.status = 'open'
                  where st.document_id = d.id))
  loop
    v_closed := v_closed + staff_tasks_private.approval_sync_doc(x.id);
  end loop;
  -- 문서가 지워진 차례
  for x in
    select t.subject_id from public.staff_tasks t
     where t.tenant_id = p_tenant and t.kind = 'approval_turn' and t.status = 'open'
       and not exists (select 1 from public.approval_steps st where st.id = t.subject_id)
  loop
    v_closed := v_closed + staff_tasks_private.close_task(p_tenant, 'approval_turn', x.subject_id, null, 'cancelled', 'deleted', null);
  end loop;
  return jsonb_build_object('opened', 0, 'closed', v_closed);
end;
$fn$;

-- ── 퇴원보고서 단계 ──────────────────────────────────────────────────────────
-- 보고서 하나의 차례 할 일을 맞춘다. 지금 차례인 사람마다 연다 · 결정한 사람·지나간 작성은 처리됨 · 없어진 차례는 취소.
create or replace function staff_tasks_private.withdrawal_sync_report(p_report uuid)
returns int
language plpgsql security definer set search_path = public
as $fn$
declare
  r record;
  v_managers uuid[];
  v_directors uuid[];
  v_student text;
  v_want text[] := '{}';
  v_cycle text;
  v_user uuid;
  v_stage text;
  v_n int := 0;
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  x record;
begin
  select wr.* into r from public.withdrawal_reports wr where wr.id = p_report;
  if r.id is null then
    return (select coalesce(sum(staff_tasks_private.close_task(t.tenant_id, 'withdrawal_step', t.subject_id, t.cycle, 'cancelled', 'deleted', null)), 0)
              from public.staff_tasks t where t.kind = 'withdrawal_step' and t.subject_id = p_report and t.status = 'open');
  end if;
  select coalesce(g.manager_ids, r.manager_ids, case when r.manager_id is null then '{}' else array[r.manager_id] end),
         coalesce(g.director_ids, r.director_ids, case when r.director_id is null then '{}' else array[r.director_id] end)
    into v_managers, v_directors
    from (select 1) one left join public.withdrawal_report_groups g on g.id = r.group_id and g.tenant_id = r.tenant_id;
  v_student := coalesce(r.snapshot ->> 'name', (select s.name from public.students s where s.id = r.student_id and s.tenant_id = r.tenant_id), '학생');

  if r.created_at >= staff_tasks_private.kind_start('withdrawal_step') then
    if r.status in ('requested', 'revision') and r.teacher_id is not null then
      v_cycle := 'write:' || r.teacher_id::text;
      v_want := v_want || v_cycle;
      perform staff_tasks_private.open_task(r.tenant_id, 'withdrawal_step', r.id, v_cycle,
        '퇴원보고서 작성', v_student || case when r.status = 'revision' then ' · 보완 요청' else '' end,
        '/withdrawal-reports/' || r.id::text, ((v_today + 3)::timestamp at time zone 'Asia/Seoul'), array[r.teacher_id], null);
    elsif r.status = 'manager_pending' then
      foreach v_user in array coalesce(v_managers, '{}') loop
        continue when r.manager_decisions ? v_user::text;
        v_cycle := 'manager:' || v_user::text;
        v_want := v_want || v_cycle;
        perform staff_tasks_private.open_task(r.tenant_id, 'withdrawal_step', r.id, v_cycle,
          '퇴원보고서 승인', v_student || ' · 관리자 승인 차례',
          '/withdrawal-reports/' || r.id::text, ((v_today + 2)::timestamp at time zone 'Asia/Seoul'), array[v_user], null);
      end loop;
    elsif r.status = 'director_pending' then
      foreach v_user in array coalesce(v_directors, '{}') loop
        continue when r.director_decisions ? v_user::text;
        v_cycle := 'director:' || v_user::text;
        v_want := v_want || v_cycle;
        perform staff_tasks_private.open_task(r.tenant_id, 'withdrawal_step', r.id, v_cycle,
          '퇴원보고서 승인', v_student || ' · 원장 승인 차례',
          '/withdrawal-reports/' || r.id::text, ((v_today + 2)::timestamp at time zone 'Asia/Seoul'), array[v_user], null);
      end loop;
    end if;
  end if;

  -- 지금 차례가 아닌 열린 할 일 = 그 사람이 끝냈으면 처리됨, 아니면(보완 요청·취소·다른 사람으로 바뀜) 취소.
  for x in
    select t.cycle from public.staff_tasks t
     where t.tenant_id = r.tenant_id and t.kind = 'withdrawal_step' and t.subject_id = r.id and t.status = 'open'
       and not (t.cycle = any(v_want))
  loop
    v_stage := split_part(x.cycle, ':', 1);
    v_user := nullif(split_part(x.cycle, ':', 2), '')::uuid;
    if (v_stage = 'write' and r.status in ('manager_pending', 'director_pending', 'approved', 'scheduled', 'completed'))
       or (v_stage = 'manager' and (r.manager_decisions ? v_user::text
                                    or r.status in ('director_pending', 'approved', 'scheduled', 'completed')))
       or (v_stage = 'director' and (r.director_decisions ? v_user::text or r.status in ('approved', 'scheduled', 'completed'))) then
      v_n := v_n + staff_tasks_private.close_task(r.tenant_id, 'withdrawal_step', r.id, x.cycle, 'done', 'withdrawal_acted', v_user);
    else
      v_n := v_n + staff_tasks_private.close_task(r.tenant_id, 'withdrawal_step', r.id, x.cycle, 'cancelled',
        case when r.status = 'canceled' then 'withdrawal_canceled' else 'turn_changed' end, null);
    end if;
  end loop;
  return v_n;
end;
$fn$;

create or replace function staff_tasks_private.tg_withdrawal_task()
returns trigger
language plpgsql security definer set search_path = public
as $fn$
begin
  perform staff_tasks_private.withdrawal_sync_report(case when tg_op = 'DELETE' then OLD.id else NEW.id end);
  return null;
exception when others then
  return null;
end;
$fn$;

drop trigger if exists trg_staff_task_withdrawal on public.withdrawal_reports;
create trigger trg_staff_task_withdrawal
  after insert or update of status, revision, teacher_id, manager_decisions, director_decisions or delete on public.withdrawal_reports
  for each row execute function staff_tasks_private.tg_withdrawal_task();

create or replace function staff_tasks_private.sync_withdrawal_step(p_tenant uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $fn$
declare
  v_closed int := 0;
  x record;
begin
  for x in
    select wr.id from public.withdrawal_reports wr
     where wr.tenant_id = p_tenant and wr.status in ('requested', 'revision', 'manager_pending', 'director_pending')
    union
    select t.subject_id from public.staff_tasks t where t.tenant_id = p_tenant and t.kind = 'withdrawal_step' and t.status = 'open'
  loop
    v_closed := v_closed + staff_tasks_private.withdrawal_sync_report(x.id);
  end loop;
  return jsonb_build_object('opened', 0, 'closed', v_closed);
end;
$fn$;

-- ── 도움말 질문 ──────────────────────────────────────────────────────────────
create or replace function staff_tasks_private.help_sync_post(p_post uuid, p_tenant uuid default null)
returns int
language plpgsql security definer set search_path = public
as $fn$
declare
  p record;
  v_answer uuid;
  v_assignees uuid[];
begin
  select hp.id, hp.tenant_id, hp.author_id, hp.title, hp.status, hp.created_at into p from public.help_posts hp where hp.id = p_post;
  if p.id is null then
    return coalesce((select sum(staff_tasks_private.close_task(t.tenant_id, 'help_question', t.subject_id, null, 'cancelled', 'deleted', null))
                       from public.staff_tasks t where t.kind = 'help_question' and t.subject_id = p_post and t.status = 'open'
                         and (p_tenant is null or t.tenant_id = p_tenant)), 0);
  end if;
  select a.author_id into v_answer from public.help_answers a
   where a.post_id = p.id and a.tenant_id = p.tenant_id and a.author_id is distinct from p.author_id
   order by a.created_at limit 1;
  if v_answer is not null or p.status in ('answered', 'closed') then
    return staff_tasks_private.close_task(p.tenant_id, 'help_question', p.id, null, 'done', 'help_answered', v_answer);
  end if;
  if p.created_at < staff_tasks_private.kind_start('help_question') then return 0; end if;
  select coalesce(array_agg(u.id), '{}') into v_assignees from public.users u
   where u.tenant_id = p.tenant_id and u.status = 'active' and u.system_role in ('master', 'admin') and u.id is distinct from p.author_id;
  perform staff_tasks_private.open_task(p.tenant_id, 'help_question', p.id, '',
    '도움말 질문 답변', coalesce(p.title, '질문'), '/help/posts/' || p.id::text,
    (((now() at time zone 'Asia/Seoul')::date + 2)::timestamp at time zone 'Asia/Seoul'), v_assignees, null);
  return 0;
end;
$fn$;

create or replace function staff_tasks_private.tg_help_task()
returns trigger
language plpgsql security definer set search_path = public
as $fn$
begin
  if tg_table_name = 'help_posts' then
    perform staff_tasks_private.help_sync_post(case when tg_op = 'DELETE' then OLD.id else NEW.id end,
                                               case when tg_op = 'DELETE' then OLD.tenant_id else NEW.tenant_id end);
  else
    perform staff_tasks_private.help_sync_post(case when tg_op = 'DELETE' then OLD.post_id else NEW.post_id end);
  end if;
  return null;
exception when others then
  return null;
end;
$fn$;

drop trigger if exists trg_staff_task_help_post on public.help_posts;
create trigger trg_staff_task_help_post
  after insert or update of status or delete on public.help_posts
  for each row execute function staff_tasks_private.tg_help_task();
drop trigger if exists trg_staff_task_help_answer on public.help_answers;
create trigger trg_staff_task_help_answer
  after insert or delete on public.help_answers
  for each row execute function staff_tasks_private.tg_help_task();

create or replace function staff_tasks_private.sync_help_question(p_tenant uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $fn$
declare
  v_closed int := 0;
  x record;
begin
  for x in
    select hp.id from public.help_posts hp where hp.tenant_id = p_tenant and hp.status = 'open'
       and hp.created_at >= staff_tasks_private.kind_start('help_question')
    union
    select t.subject_id from public.staff_tasks t where t.tenant_id = p_tenant and t.kind = 'help_question' and t.status = 'open'
  loop
    v_closed := v_closed + staff_tasks_private.help_sync_post(x.id, p_tenant);
  end loop;
  return jsonb_build_object('opened', 0, 'closed', v_closed);
end;
$fn$;

-- ── 알림이 들어올 때 같은 링크의 열린 할 일에 잇는다 ───────────────────────────
-- 앱(전자결재·도움말)과 퇴원보고서 함수가 알림을 따로 넣는다. 받는 사람이 맡은 열린 할 일 중 링크가 같은 것 하나.
create or replace function staff_tasks_private.tg_notification_task_link()
returns trigger
language plpgsql security definer set search_path = public
as $fn$
declare
  v_kind text;
begin
  if NEW.task_id is not null or NEW.link is null then return NEW; end if;
  v_kind := case
    when NEW.type = 'approval_requested' and NEW.link like '/approvals/%' then 'approval_turn'
    when NEW.type = 'approval_requested' and NEW.link like '/withdrawal-reports/%' then 'withdrawal_step'
    when NEW.type = 'help_question' then 'help_question'
    else null end;
  if v_kind is null then return NEW; end if;
  select t.id into NEW.task_id from public.staff_tasks t
    join public.staff_task_assignees a on a.task_id = t.id and a.user_id = NEW.recipient_id
   where t.tenant_id = NEW.tenant_id and t.kind = v_kind and t.status = 'open' and t.link = NEW.link
   order by t.opened_at desc limit 1;
  return NEW;
exception when others then
  return NEW; -- 연결이 실패해도 알림은 그대로 들어간다.
end;
$fn$;

drop trigger if exists trg_staff_task_notification_link on public.notifications;
create trigger trg_staff_task_notification_link
  before insert on public.notifications
  for each row when (NEW.type in ('approval_requested', 'help_question'))
  execute function staff_tasks_private.tg_notification_task_link();

-- ── 30분 맞춤 = 종류 셋 더 ───────────────────────────────────────────────────
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
                                                   'approval_turn', 'withdrawal_step', 'help_question']) loop
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
