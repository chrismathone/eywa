-- 월간계획 전체 가져오기 **되돌리기** 기록(원장 2026-10-15 *"월간계획 전체 가져왔을때 실행취소 하는 방법이 필요"*
-- → 알림의 [실행 취소] + 가져오기 버튼 옆 ▾ 메뉴의 "마지막 가져오기 되돌리기").
--
-- 🔑 무엇을 담나: 가져오기 **한 번**이 실제 계획 줄(`class_sheet_plan_lines`)에 한 일 — 새로 만든 줄(id + 넣은 값)과
--    빈 칸을 채운 줄(id + 채우기 전·후 값). 되돌리기는 이 기록과 **지금 값이 같은 칸만** 원래대로 돌린다
--    (가져온 뒤 고쳐 쓴 칸은 남긴다 — 규칙은 src/features/textbooks/import-undo.ts 한 곳).
-- 🔑 되돌리는 대상은 반마다 **가장 최근 가져오기 하나뿐**이다 — 최근 것을 되돌리면 더 옛것으로 내려가지 않는다
--    (몇 주 전 가져오기가 메뉴에 다시 떠오르면 무엇을 지우는지 알기 어렵다).
-- ⚠️ 앱은 이 표가 없어도 돈다([[#95]]) — 가져오기는 그대로 되고, 기록이 안 남아 되돌리기 메뉴만 안 보인다.
--
-- 롤백:
--   drop table if exists public.class_plan_import_batches;
set local statement_timeout = '60s';

create table if not exists public.class_plan_import_batches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  class_id uuid not null,
  period_from date not null,
  period_to date not null,
  -- [{ id, added, after: {textbook,page_range,progress,homework}, before?: {...} }] — 한 번에 수백 줄 이하.
  rows jsonb not null default '[]'::jsonb,
  row_count integer not null default 0,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  undone_by uuid references public.users(id) on delete set null
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'class_plan_import_batches_class_fk') then
    alter table public.class_plan_import_batches
      add constraint class_plan_import_batches_class_fk
      foreign key (tenant_id, class_id) references public.classes (tenant_id, id) on delete cascade;
  end if;
end $$;

-- "그 반의 가장 최근 가져오기"가 타는 축.
create index if not exists class_plan_import_batches_class_idx
  on public.class_plan_import_batches (tenant_id, class_id, created_at desc);

comment on table public.class_plan_import_batches is
  '월간계획 전체 가져오기 한 번이 실제 계획 줄에 한 일 — 되돌리기용(반마다 최근 하나만 되돌린다).';

-- ── RLS — 읽기는 테넌트 전원, 쓰기는 service_role(서버 액션)만 (0282a와 같은 모양) ──────────
alter table public.class_plan_import_batches enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'class_plan_import_batches' and policyname = 'class_plan_import_batches_read'
  ) then
    create policy class_plan_import_batches_read on public.class_plan_import_batches
      for select using (tenant_id = public.auth_tenant_id());
  end if;
end $$;

notify pgrst, 'reload schema';
