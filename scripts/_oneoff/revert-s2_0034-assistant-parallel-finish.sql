-- s2_0034 되돌리기 — 앱을 s2_0034 이전 판으로 되돌린 **뒤에만** 쓴다(새 앱은 run_slot·client_ref·wrap_requested_at을 쓴다).
-- 사람당 '도는 질문'이 둘 이상이면 옛 색인을 만들 수 없다 → 먼저 그 사람의 가장 오래된 하나만 남기고 나머지를 '실패'로 닫는다.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

update public.assistant_messages m
   set status = 'failed', error = '답을 끝내지 못했습니다. 다시 물어봐 주세요', finished_at = now()
 where m.status = 'running' and m.cancel_requested_at is null
   and exists (
     select 1 from public.assistant_messages o
      where o.tenant_id = m.tenant_id and o.user_id = m.user_id
        and o.status = 'running' and o.cancel_requested_at is null
        and (o.created_at, o.id) < (m.created_at, m.id));

create unique index if not exists assistant_messages_one_running_idx
  on public.assistant_messages (tenant_id, user_id)
  where status = 'running' and cancel_requested_at is null;
drop index if exists public.assistant_messages_running_slot_idx;
drop index if exists public.assistant_messages_running_thread_idx;
alter table public.assistant_messages
  drop column if exists run_slot,
  drop column if exists client_ref,
  drop column if exists wrap_requested_at;
alter role aywa_assistant connection limit 4;
commit;
