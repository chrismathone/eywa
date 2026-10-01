-- 0323a — 셔틀 변경 내역 '확인' 표식 (사용자 2026-09-30)
--
-- 관리자 '학부모 등하원' 카드의 변경 내역(0321a 그날 변경 · 0322a 고정 변경)에 [확인] 버튼을 두고,
-- 확인한 줄은 **화면에서만** 내린다. "실제 디비는 남지만 더이상 화면 뷰에서 나오지 않게".
--
-- 🔑 장부 두 표는 **추가만 되는 표**다(트리거가 service_role의 수정·삭제까지 막는다) — 그래서 장부 줄에
--    컬럼을 달아 고치지 않고, 확인 사실을 **이 표에 따로** 한 줄씩 쌓는다. 장부는 한 글자도 안 바뀐다.
-- 🔑 확인은 **학원 공용**이다(한 직원이 확인하면 다른 직원 화면에서도 내려간다) — 데스크가 처리했다는 뜻이라
--    사람마다 따로 두면 같은 변경을 세 사람이 각자 확인해야 한다. 누가·언제 확인했는지는 이 줄에 남는다.
-- 🔑 쓰기는 service_role 전용(서버 액션이 게이트 뒤에서 admin으로 쓴다) — 정책은 읽기만.
--
-- 되돌리기:
--   drop table if exists public.shuttle_history_acks;

set local statement_timeout = '60s';

create table if not exists public.shuttle_history_acks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  -- ride = shuttle_ride_exception_history(0321a) · regular = shuttle_rider_history(0322a)
  history_kind text not null constraint shuttle_history_acks_kind check (history_kind in ('ride', 'regular')),
  history_id uuid not null,
  acked_by uuid,
  acked_by_name text,
  acked_at timestamptz not null default now()
);

comment on table public.shuttle_history_acks is
  '셔틀 변경 내역 확인 표식(0323a) — 확인한 장부 줄은 직원 화면에서 내린다. 장부(0321a·0322a)는 그대로.';

-- 🔴 부분 유니크(WHERE) 금지 — 이 축으로 upsert한다([[#113]]).
create unique index if not exists shuttle_history_acks_uniq
  on public.shuttle_history_acks (tenant_id, history_kind, history_id);

alter table public.shuttle_history_acks enable row level security;
drop policy if exists shuttle_history_acks_tenant_read on public.shuttle_history_acks;
create policy shuttle_history_acks_tenant_read on public.shuttle_history_acks
  for select using (tenant_id = public.auth_tenant_id());

notify pgrst, 'reload schema';
