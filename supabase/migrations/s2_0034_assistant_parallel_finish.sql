-- s2_0034_assistant_parallel_finish.sql — 학원 비서: 동시에 3개까지 · '여기서 끝내고 결과 보기' · 2026-11-06
--
-- 원장 2026-11-06 *"대화를 여러개 동시에 시작할 수 있는지"* → '동시에 3개까지'를 골랐다(조회 한도를 없애 답 하나가 최대 13분쯤 걸릴 수 있다).
-- 원장 2026-11-06 *"'여기서 조회 끝내고 바로 결과 출력' 버튼 만들자. 그럼 조회 멈추고, 지금까지 조회한 내용으로만 결과 출력"*.
-- 설계 = docs/features/academy-assistant.md §7-3.
--
-- 🔴 원장 승인 전 운영 적용 금지. 순서 = 이 SQL → 앱 배포(새 앱이 새 칸을 쓴다 — 앱을 먼저 올리면 질문 저장이 실패한다).
--    SQL만 들어간 사이(배포 몇 분)에는 옛 앱이 run_slot 없이 넣는다 → 사람당 하나를 막던 색인이 빠져 두 탭 동시 질문은 옛 앱의 확인만 막는다(짧은 경쟁 상태).
--    대화마다 하나(②)는 그 사이에도 색인이 막는다.
--
-- 바꾸는 것
--   ① run_slot(1~3) — 사람당 '도는 질문' 자리. 고유 색인 (tenant_id, user_id, run_slot)이 동시에 3개까지만 들어가게 한다
--      (앱의 확인은 읽고-쓰기 사이가 비어 있다 — 두 탭이 동시에 넷째를 넣지 못하게 DB가 막는다).
--   ② 대화마다 '도는 질문'은 하나 — 고유 색인 (thread_id). 같은 대화에 두 질문이 겹치면 둘째가 첫째의 답을 모르고 답한다.
--   ③ client_ref — 화면이 보낼 때 만든 번호. 질문 번호(started)를 받기 전에 누른 멈춤·마무리가 '그 질문'을 찾는다
--      (사람당 하나일 때 쓰던 '지금 도는 내 질문'은 셋 중 어느 것인지 모른다).
--   ④ wrap_requested_at — '여기서 끝내고 결과 보기'. 도는 쪽이 2초마다 보고 더 조회하지 않고 보고서를 쓴다(다른 서버 인스턴스에서 돌아도 같다).
--   ⑤ 비서 역할 연결 상한 4 → 12 — 동시 질문(사람당 3 · 여러 지점·사람 합계)과 정리 중인 질문의 조회 거래가 겹친다
--      (운영 실측 2026-11-06: max_connections 90 · 쓰는 연결 42 · 질문 하나는 조회 거래 동안만 연결을 쓴다 · 적대 리뷰 2026-11-09).
--   ⑥ 옛 색인 assistant_messages_one_running_idx(사람당 하나) 삭제.
-- '멈춤'을 누른 질문은 ①② 모두에서 빠진다(마무리 중이어도 새 질문을 막지 않는다 — s2_0031과 같다).
-- 함수가 죽어 남은 '도는 중'은 앱이 15분(ASSISTANT_RUNNING_MS) 뒤 실패로 닫는다(store.ts admission) — 자리도 그때 풀린다.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.assistant_messages
  add column if not exists run_slot smallint check (run_slot between 1 and 3),
  add column if not exists client_ref uuid,
  add column if not exists wrap_requested_at timestamptz;

create unique index if not exists assistant_messages_running_slot_idx
  on public.assistant_messages (tenant_id, user_id, run_slot)
  where status = 'running' and cancel_requested_at is null;
create unique index if not exists assistant_messages_running_thread_idx
  on public.assistant_messages (thread_id)
  where status = 'running' and cancel_requested_at is null;
drop index if exists public.assistant_messages_one_running_idx;

alter role aywa_assistant connection limit 12;

-- ── 사후 확인 ──────────────────────────────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'assistant_messages'
         and column_name in ('run_slot', 'client_ref', 'wrap_requested_at')) <> 3 then
    raise exception 's2_0034: 새 칸이 다 생기지 않았습니다';
  end if;
  if to_regclass('public.assistant_messages_running_slot_idx') is null
     or to_regclass('public.assistant_messages_running_thread_idx') is null then
    raise exception 's2_0034: 새 색인이 생기지 않았습니다';
  end if;
  if to_regclass('public.assistant_messages_one_running_idx') is not null then
    raise exception 's2_0034: 옛 색인(사람당 하나)이 남았습니다';
  end if;
  if (select rolconnlimit from pg_roles where rolname = 'aywa_assistant') <> 12 then
    raise exception 's2_0034: 비서 역할 연결 상한이 12가 아닙니다';
  end if;
end $$;

commit;
