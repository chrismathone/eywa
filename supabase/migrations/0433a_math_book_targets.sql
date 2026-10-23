-- 수학 교재 전체 목표 — 사람이 고른 **목표 권** 하나(원장 2026-10-20 *"최종목표가 설정되면 수정되게도 교재단위로"*).
--
-- 🔑 목표는 기본이 **자동**(주문일+7일부터 내신기간을 뺀 3개월에 2권 · 중3 11월 말까지 끝낼 수 있는 마지막 권,
--    src/features/textbooks/book-roadmap.ts)이라 이 표엔 아무것도 없다. 사람이 다른 권을 골랐을 때만 한 줄이 생긴다.
--    '자동으로 되돌리기' = 행 삭제.
-- 🔑 자리 = 학생 × 교재 시리즈(`가우스`). 반이 아니라 학생의 사실이다(반을 옮겨도 목표는 따라간다).
--    target_key = 교재목록 열쇠 모양(`가우스|중3-2|3`) — 아직 교재목록에 없는 권도 고를 수 있어 교재 id를 쓰지 않는다.
-- 🔴 부분 유니크(WHERE) 금지([[#113]]).
-- ⚠️ 앱은 이 표가 없어도 돈다([[#95]]) — 자동 목표만 보이고 '목표 권 변경'만 잠긴다.
--
-- 롤백:
--   drop table if exists public.math_book_targets;
set local statement_timeout = '60s';

create table if not exists public.math_book_targets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  series text not null check (length(series) between 1 and 40),
  target_key text not null check (length(target_key) between 1 and 80),
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint math_book_targets_slot_uniq unique (tenant_id, student_id, series)
);

comment on table public.math_book_targets is
  '수학 교재 전체 목표 — 학생 × 시리즈마다 사람이 고른 목표 권(없으면 자동 목표).';

drop trigger if exists math_book_targets_set_updated_at on public.math_book_targets;
create trigger math_book_targets_set_updated_at before update on public.math_book_targets
  for each row execute function public.tg_set_updated_at();

-- ── RLS — 읽기는 테넌트 전원, 쓰기는 service_role(서버 액션)만 (math_textbook_assignments와 같은 모양) ──
alter table public.math_book_targets enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'math_book_targets' and policyname = 'math_book_targets_read'
  ) then
    create policy math_book_targets_read on public.math_book_targets
      for select using (tenant_id = public.auth_tenant_id());
  end if;
end $$;

notify pgrst, 'reload schema';
