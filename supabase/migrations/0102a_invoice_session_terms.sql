-- 0102a: 청구=N회 키스톤 — 회차 확정 테이블 + 단가표 회당/월 판별 컬럼
-- 설계 = docs/per-session-billing-plan.md (2026-07-13 원장 확정).
-- ⚠️ invoices.line_items 안에 넣지 않는 이유: makeedu upsert 동기화가 line_items를 통째 교체(커스텀 키 전멸)
--    + 라인 identity 불안정. invoices.id는 upsert에서 보존되므로 FK 별도 테이블이 안전 영역.
-- 불변규칙 N1: confirmed_sessions(수기 확정)만 청구값 — planned_sessions(자동 산출)는 프리필·참고 전용.
-- 불변규칙 N2: invoices.amount_total과 자동 일치화 금지 — diff가 검증 신호.

create table if not exists public.invoice_session_terms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  subject text not null,                    -- 운영 enum key(설정 단일소스). 비수업 항목 유입 금지(N3)
  -- 반 단위 키 — 같은 과목 복수 반(예: 중등+초등 수학)도 합산 금지: 반마다 회당 단가가 다름(2026-07-13 원장 지시)
  class_id uuid not null references public.classes(id) on delete cascade,
  planned_sessions int,                     -- 자동 산출(계획 N): 스케줄×청구월−공휴일
  confirmed_sessions int,                   -- 수기 확정 N — null=미확정. 청구값으로 인정되는 유일한 값
  unit_price numeric(12,0),                 -- 회당 단가(확정 시 저장)
  amount numeric(12,0),                     -- 확정 시 confirmed_sessions × unit_price 스냅샷
  confirmed_by uuid references public.users(id) on delete set null,
  confirmed_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, invoice_id, class_id)
);

create index if not exists invoice_session_terms_invoice_idx
  on public.invoice_session_terms (tenant_id, invoice_id);

-- 초기(과목 합산) 형태로 이미 생성된 DB 정정 — 신설 직후라 데이터는 계획값뿐(확정 0), 지우고 재산출.
do $$
begin
  if exists (
    select 1 from information_schema.table_constraints
    where table_name = 'invoice_session_terms' and constraint_name = 'invoice_session_terms_tenant_id_invoice_id_subject_key'
  ) then
    delete from public.invoice_session_terms; -- 계획 전용 행(확정 도입 전) — 반 단위로 재생성
    alter table public.invoice_session_terms drop constraint invoice_session_terms_tenant_id_invoice_id_subject_key;
    alter table public.invoice_session_terms drop constraint if exists invoice_session_terms_class_id_fkey;
    alter table public.invoice_session_terms alter column class_id set not null;
    alter table public.invoice_session_terms
      add constraint invoice_session_terms_class_id_fkey
      foreign key (class_id) references public.classes(id) on delete cascade;
    alter table public.invoice_session_terms
      add constraint invoice_session_terms_tenant_id_invoice_id_class_id_key
      unique (tenant_id, invoice_id, class_id);
  end if;
end $$;

alter table public.invoice_session_terms enable row level security;

drop policy if exists invoice_session_terms_tenant_isolation on public.invoice_session_terms;
create policy invoice_session_terms_tenant_isolation on public.invoice_session_terms
  for all to authenticated
  using (tenant_id = public.auth_tenant_id())
  with check (tenant_id = public.auth_tenant_id());

drop trigger if exists invoice_session_terms_set_updated_at on public.invoice_session_terms;
create trigger invoice_session_terms_set_updated_at
  before update on public.invoice_session_terms
  for each row execute function public.tg_set_updated_at();

-- 단가표 회당/월/할인 판별 — price가 "회당 단가 또는 월 단가 또는 할인액"으로 미구분이라, 판별 없이
-- sessions×price를 곱하면 월 수강료를 회당으로 곱하는 사고(attendance 200만원대 실사고) 재발(N5).
-- null = 미지정(곱셈 금지·프리필 후보에서 제외).
alter table public.tuition_catalog
  add column if not exists pricing_mode text
  check (pricing_mode in ('per_session', 'monthly', 'discount'));

comment on column public.tuition_catalog.pricing_mode is
  '단가 의미: per_session=회당 단가(회차 확정 프리필 대상) / monthly=월 단가 / discount=할인액. null=미지정(곱셈 금지)';
