-- s2_0011 — 환불 처리 할 일: 퇴원보고서에서 원장이 환불을 승인하며 지정한 데스크 담당자의 '내 할 일' (2026-10-29)
--
-- 왜: 원장 *"환불이 필요한 학생일 경우에, 데스크 담당자를 지정할 수 있게 하면 될듯. 그럼 알림이 자연스럽게 가겠지. 내 할일에 추가되서"*.
--     할 일(0377a staff_tasks)은 staff_tasks_private 함수로만 열리는데 그 스키마는 앱(PostgREST)에 열려 있지 않다 → 공개 감싸개 하나.
-- 무엇:
--   ① public.refund_desk_task_open — 환불 요청서 하나 = 할 일 하나(kind 'refund_process', 대상 = 요청서 id). 서버 키(service_role)만 부른다.
--   ② academy_documents 트리거 — 요청서에 환불완료일자가 처음 들어가면 그 할 일을 '처리됨', 요청서를 지우면 '취소'.
--      할 일 기록이 문서 저장을 막지 않는다(예외는 삼킨다 — 다른 할 일 트리거와 같은 규약).
-- 앱은 이 SQL 전에도 돈다(감싸개가 없으면 할 일만 건너뛰고 알림은 간다).
-- 되돌리기 = scripts/_oneoff/revert-s2_0011-refund-desk-task.sql

do $mig$
begin
  execute $f$
create or replace function public.refund_desk_task_open(p_tenant uuid, p_document uuid, p_assignee uuid, p_title text, p_detail text, p_actor uuid)
returns uuid
language plpgsql security definer set search_path = public
as $fn$
begin
  if not exists (select 1 from public.academy_documents d where d.id = p_document and d.tenant_id = p_tenant and d.form_type = 'refund_request') then
    raise exception '환불 요청서를 찾을 수 없습니다.';
  end if;
  return staff_tasks_private.open_task(p_tenant, 'refund_process', p_document, 'refund', p_title, p_detail,
    '/billing/refunds/' || p_document::text, now() + interval '1 day', array[p_assignee], p_actor);
end;
$fn$;
$f$;
  execute 'revoke all on function public.refund_desk_task_open(uuid,uuid,uuid,text,text,uuid) from public, anon, authenticated';
  execute 'grant execute on function public.refund_desk_task_open(uuid,uuid,uuid,text,text,uuid) to service_role';

  execute $f$
create or replace function staff_tasks_private.tg_refund_task()
returns trigger
language plpgsql security definer set search_path = public
as $fn$
declare
  v_actor uuid := auth.uid();
begin
  if tg_op = 'DELETE' then
    if OLD.form_type = 'refund_request' then
      perform staff_tasks_private.close_task(OLD.tenant_id, 'refund_process', OLD.id, null, 'cancelled', 'deleted', v_actor);
    end if;
    return null;
  end if;
  if NEW.form_type = 'refund_request'
     and coalesce(btrim(NEW.form_data #>> '{result,completedDate}'), '') <> ''
     and coalesce(btrim(OLD.form_data #>> '{result,completedDate}'), '') = '' then
    perform staff_tasks_private.close_task(NEW.tenant_id, 'refund_process', NEW.id, null, 'done', 'refund_completed', v_actor);
  end if;
  return null;
exception when others then
  return null;
end;
$fn$;
$f$;
  execute 'revoke all on function staff_tasks_private.tg_refund_task() from public, anon, authenticated';
  execute 'drop trigger if exists trg_staff_task_refund on public.academy_documents';
  execute 'create trigger trg_staff_task_refund after update of form_data or delete on public.academy_documents for each row execute function staff_tasks_private.tg_refund_task()';
end $mig$;
