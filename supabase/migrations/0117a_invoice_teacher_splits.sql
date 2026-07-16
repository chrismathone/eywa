-- 0117a: 강사 분배 스냅샷(invoice_teacher_splits) — 로드맵 2단계 (b), 골든마스터(N6) 통과 후 착수.
-- 설계 = docs/per-session-billing-plan.md + attendance payment_shares 교훈.
--
-- 시수 검증의 강사별 분배(참고 집계)를 기간 단위로 **스냅샷 저장**한다:
-- 행 = (청구서 × 반) — session_terms와 동일 결(반 단위, 같은 강사 두 반도 절대 병합 금지 — attendance hasAny 사고).
-- teacher_id/teacher_name은 저장 시점 담당 강사 스냅샷 — 이후 담당 변경/퇴직에도 분배 기록 불변.
--
-- 불변 규칙:
-- - N1: 확정 행(confirmed_sessions·unit_price 보유)만 저장 — 미확정은 돈이 아님.
-- - N2: 이 테이블은 기록일 뿐 invoices를 절대 변경하지 않는다(자동 일치화 금지).
-- - R3(attendance): confirmed_amount(청구 기준)와 actual_amount(실측 기준)는 같은 분배의 두 표현 — 합산 금지.

create table if not exists invoice_teacher_splits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  period text not null,                     -- 'YYYY-MM' (invoices.period 복제 — 기간 조회·재저장 키)
  subject text not null,                    -- 운영 enum key
  teacher_id uuid references public.users(id) on delete set null, -- 저장 시점 담당(null=미배정)
  teacher_name text,                        -- 표시 스냅샷(개명·삭제 후에도 기록 보존)
  confirmed_sessions int not null,          -- 저장 시점 확정 회차
  unit_price numeric(12,0) not null,        -- 저장 시점 회당 단가
  confirmed_amount numeric(12,0) not null,  -- 청구 기준 분배액 = 확정 시점 amount(회차×단가)
  actual_units numeric(6,1) not null,       -- 저장 시점 실 소비 시수 합(0115a RPC)
  actual_amount numeric(12,0) not null,     -- 실측 기준 분배액 = round(실 시수 × 단가)
  diff_amount numeric(12,0) not null,       -- 실측 − 청구(음수=과청구 신호·양수=미청구 신호)
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, invoice_id, class_id)
);

create index if not exists invoice_teacher_splits_period_idx
  on invoice_teacher_splits (tenant_id, period);
create index if not exists invoice_teacher_splits_teacher_idx
  on invoice_teacher_splits (tenant_id, teacher_id);

alter table invoice_teacher_splits enable row level security;
drop policy if exists invoice_teacher_splits_tenant_isolation on public.invoice_teacher_splits;
create policy invoice_teacher_splits_tenant_isolation on public.invoice_teacher_splits
  for all to authenticated
  using (tenant_id = public.auth_tenant_id())
  with check (tenant_id = public.auth_tenant_id());

drop trigger if exists invoice_teacher_splits_set_updated_at on public.invoice_teacher_splits;
create trigger invoice_teacher_splits_set_updated_at
  before update on public.invoice_teacher_splits
  for each row execute function public.tg_set_updated_at();

comment on table invoice_teacher_splits is
  '강사 분배 스냅샷(기간 단위 저장, 청구서×반 1행). 기록 전용 — invoices 불변(N2). docs/per-session-billing-plan.md (b)';
