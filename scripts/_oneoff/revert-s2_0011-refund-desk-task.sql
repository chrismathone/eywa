-- s2_0011 되돌리기 — 환불 처리 할 일 감싸개·트리거를 뗀다(이미 열린 할 일 행은 그대로 둔다).
do $$
begin
  execute 'drop trigger if exists trg_staff_task_refund on public.academy_documents';
  execute 'drop function if exists staff_tasks_private.tg_refund_task()';
  execute 'drop function if exists public.refund_desk_task_open(uuid,uuid,uuid,text,text,uuid)';
end $$;
