-- 0213a — 전자결재 v2: 하이웍스 수준 구성(결재선 직접 지정 + 자주 쓰는 결재선 저장 + 참조 + 결재함 세분화)
--
-- 원장 방향(2026-08-14): *"하이웍스 기준으로 디자인 및 기능 따서 우리 디자인에 맞게 재구현하자.
-- 결재선도 하이웍스처럼 실제 전자결재처럼 저장해서 어디까지 결재되고 이런거 모두."*
--
-- 🔑 **이 파일 하나가 전자결재 DB 전부다** — 0212a는 프로덕션에 적용되기 전에 이 파일로 대체됐다
--    (0212a의 DDL을 전부 포함 + 하이웍스 확장). 원장은 **0213a만** 실행하면 된다.
--    (0210a·0211a·0212a는 역사 기록 — 이미 적용된 DB에 다시 돌려도 멱등이라 무해.)
--
-- 하이웍스에서 가져온 구성(가비아 매뉴얼·개편 공지 기준):
--   · 결재함 세분화 — 결재할 문서(대기) / 결재 예정 / 진행 / 완료 / 반려 / **참조**
--   · 결재선 직접 지정 — 기안 시 결재자와 순서를 고른다(순차). 표는 이미 순차 모델(current_step).
--   · **자주 쓰는 결재선 저장** — `approval_line_templates`(개인 소유, 이름 붙여 저장·불러오기)
--   · **참조(열람)** — `approval_refs`(결재하지 않고 보기만 하는 사람, 참조 문서함에 뜬다)
--   ⚠️ 합의(병렬 동의)·수신·회람·임시저장은 이번 범위 밖 — 필요해지면 steps.kind/refs.kind로 확장.
--
-- ⚠️ RLS 교차 조회는 **함수 하나**(auth_can_read_approval_doc)에 모은다 — 정책이 서로의 표를 직접
--    조회하면 무한 재귀 42P17로 표 전체가 안 읽힌다([[#109]], 0210a 실사고).
-- ⚠️ 쓰기는 서버 액션(service_role) 전용 — 잔여 검증·단계 진행·결재선 검증이 전부 서버 판단.
-- 롤백: drop table approval_refs, approval_line_templates, leave_forms, approval_steps,
--       approval_documents; drop function auth_can_read_approval_doc(uuid);
set local statement_timeout = '60s';

-- ── 옛 휴가 전용 표 정리(프로덕션 실측 0행, 2026-08-14) ─────────────────────
drop table if exists public.leave_approvals;
drop table if exists public.leave_requests;
drop function if exists public.auth_is_leave_approver(uuid);
drop function if exists public.auth_is_leave_requester(uuid);

-- ── 결재 문서(껍데기 — 양식 중립) ────────────────────────────────────────────
create table if not exists public.approval_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- 문서번호 '휴가-2026-0001'. 사람이 부르는 이름이라 표시·검색용이고 판정에는 쓰지 않는다.
  doc_no text not null,
  form_type text not null
    constraint approval_documents_form_valid check (form_type in ('leave')),
  title text not null,
  drafter_id uuid not null references public.users(id) on delete cascade,

  status text not null default 'pending'
    constraint approval_documents_status_valid check (status in ('pending', 'approved', 'rejected', 'canceled')),
  -- 지금 결재할 차례(순차). 1부터. 완료·반려되면 더 안 움직인다 — "어디까지 결재됐나"의 단일 근거.
  current_step smallint not null default 1,
  submitted_at timestamptz not null default now(),
  completed_at timestamptz,
  outcome_note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, doc_no)
);

comment on table public.approval_documents is
  '전자결재 문서 1건(양식 중립). 양식별 상세는 leave_forms 같은 1:1 표에. 결재선은 approval_steps, 참조는 approval_refs. 0213a';
comment on column public.approval_documents.current_step is
  '순차 결재의 현재 차례(1부터). 이 단계의 결재자만 처리할 수 있다 — "어디까지 결재됐나" 판정의 단일 근거.';

create index if not exists approval_documents_tenant_status_idx
  on public.approval_documents (tenant_id, status, submitted_at desc);
create index if not exists approval_documents_drafter_idx
  on public.approval_documents (tenant_id, drafter_id, submitted_at desc);

-- ── 결재선(순차) ─────────────────────────────────────────────────────────────
create table if not exists public.approval_steps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  document_id uuid not null references public.approval_documents(id) on delete cascade,
  step_no smallint not null constraint approval_steps_step_positive check (step_no >= 1),
  approver_id uuid not null references public.users(id) on delete cascade,
  -- 결재란에 찍히는 직함 라벨('검토'·'승인'). 조직 직급이 아니라 **이 문서에서의 역할**이다.
  role_label text not null default '승인',
  decision text not null default 'pending'
    constraint approval_steps_decision_valid check (decision in ('pending', 'approved', 'rejected')),
  decided_at timestamptz,
  comment text,
  created_at timestamptz not null default now(),
  unique (document_id, step_no),
  -- 한 사람이 같은 문서에 두 칸을 가질 수 없다(같은 사람에게 두 번 묻는 결재선은 실수다).
  unique (document_id, approver_id)
);

comment on table public.approval_steps is
  '결재선 한 칸. step_no가 곧 순서이고, 문서의 current_step과 같은 칸만 처리할 수 있다. 기안 시점 명단을 행으로 동결. 0213a';

create index if not exists approval_steps_approver_idx
  on public.approval_steps (tenant_id, approver_id, decision);
create index if not exists approval_steps_document_idx
  on public.approval_steps (document_id, step_no);

-- ── 참조(열람) — 하이웍스 '참조' ─────────────────────────────────────────────
create table if not exists public.approval_refs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  document_id uuid not null references public.approval_documents(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (document_id, user_id)
);

comment on table public.approval_refs is
  '참조자(결재하지 않고 열람만) — 하이웍스 참조. 기안 시점 지정, 참조 문서함에 뜬다. 0213a';

create index if not exists approval_refs_user_idx on public.approval_refs (tenant_id, user_id);
create index if not exists approval_refs_document_idx on public.approval_refs (document_id);

-- ── 자주 쓰는 결재선(개인 저장) — 하이웍스 '자주 쓰는 결재선' ────────────────
create table if not exists public.approval_line_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  owner_id uuid not null references public.users(id) on delete cascade,
  name text not null constraint approval_line_templates_name_len check (char_length(name) between 1 and 40),
  -- 순서 있는 결재자 id 배열 + 참조자 id 배열. jsonb인 이유: 템플릿은 **개인 메모**라 집계·조인이 없고
  -- (B2 대상 아님), 적용 시점에 서버 액션이 실재·자격을 다시 검증한다(지워진 직원은 그때 걸러진다).
  approver_ids jsonb not null default '[]'::jsonb,
  ref_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 같은 사람의 같은 이름 템플릿은 하나(덮어쓰기 upsert 대상).
  unique (tenant_id, owner_id, name)
);

comment on table public.approval_line_templates is
  '자주 쓰는 결재선(개인 소유) — 기안 화면에서 이름으로 저장·불러오기. 적용 시 서버가 자격을 재검증한다. 0213a';

create index if not exists approval_line_templates_owner_idx
  on public.approval_line_templates (tenant_id, owner_id);

-- ── 휴가신청서 상세(양식 1호) ────────────────────────────────────────────────
create table if not exists public.leave_forms (
  document_id uuid primary key references public.approval_documents(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,

  leave_kind text not null default 'annual'
    constraint leave_forms_kind_valid check (leave_kind in ('annual', 'half')),
  start_date date not null,
  end_date date not null,
  constraint leave_forms_range_ordered check (end_date >= start_date),
  days numeric(4, 1) not null constraint leave_forms_days_positive check (days > 0),
  reason text,

  -- 차감 근거 동결(기안 시점 계산) — 입사일이 나중에 정정돼도 이미 결재된 문서의 근거가 흔들리지 않게.
  period_start date not null,
  period_end date not null,
  granted_days numeric(4, 1) not null constraint leave_forms_granted_nonneg check (granted_days >= 0)
);

comment on table public.leave_forms is
  '휴가신청서 상세(결재 문서 1:1). 연차 부여는 users.hire_date에서 계산(features/leave/accrual.ts) — period_*/granted_days는 기안 시점 동결. 0213a';

create index if not exists leave_forms_user_period_idx
  on public.leave_forms (tenant_id, user_id, period_start);

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- 🔑 교차 조회는 이 함수 하나로 모은다([[#109]] — 정책이 서로의 표를 직접 조회하면 42P17).
--    security definer라 함수 안에서는 RLS가 다시 걸리지 않아 고리가 없다.
--    돌려주는 건 **볼 수 있는가(boolean)** 뿐 — RPC로 직접 불려도 남의 데이터가 안 샌다.
create or replace function public.auth_can_read_approval_doc(p_doc uuid) returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from public.approval_documents d
    where d.id = p_doc
      and d.tenant_id = public.auth_tenant_id()
      and (
        d.drafter_id = auth.uid()                                   -- 내가 기안한 문서
        or exists (                                                  -- 내가 결재선에 있는 문서
          select 1 from public.approval_steps s
          where s.document_id = d.id and s.approver_id = auth.uid()
        )
        or exists (                                                  -- 내가 참조로 지정된 문서
          select 1 from public.approval_refs r
          where r.document_id = d.id and r.user_id = auth.uid()
        )
        or exists (                                                  -- 원장은 전 문서
          select 1 from public.users u
          where u.id = auth.uid() and u.system_role = 'master' and u.tenant_id = d.tenant_id
        )
      )
  )
$$;

revoke all on function public.auth_can_read_approval_doc(uuid) from public;
grant execute on function public.auth_can_read_approval_doc(uuid) to authenticated, service_role;
comment on function public.auth_can_read_approval_doc(uuid) is
  '전자결재 열람 자격(기안자·결재자·참조자·원장) — 정책 안에서 표를 직접 조회하면 상호 재귀(42P17)라 security definer로 모았다. 0213a';

alter table public.approval_documents enable row level security;
alter table public.approval_steps enable row level security;
alter table public.approval_refs enable row level security;
alter table public.approval_line_templates enable row level security;
alter table public.leave_forms enable row level security;

drop policy if exists approval_documents_read on public.approval_documents;
create policy approval_documents_read on public.approval_documents
  for select
  using (tenant_id = public.auth_tenant_id() and public.auth_can_read_approval_doc(id));

drop policy if exists approval_steps_read on public.approval_steps;
create policy approval_steps_read on public.approval_steps
  for select
  using (tenant_id = public.auth_tenant_id() and public.auth_can_read_approval_doc(document_id));

drop policy if exists approval_refs_read on public.approval_refs;
create policy approval_refs_read on public.approval_refs
  for select
  using (tenant_id = public.auth_tenant_id() and public.auth_can_read_approval_doc(document_id));

drop policy if exists leave_forms_read on public.leave_forms;
create policy leave_forms_read on public.leave_forms
  for select
  using (tenant_id = public.auth_tenant_id() and public.auth_can_read_approval_doc(document_id));

-- 자주 쓰는 결재선은 **본인 것만**(교차 참조 없음 — 함수 불필요).
drop policy if exists approval_line_templates_self on public.approval_line_templates;
create policy approval_line_templates_self on public.approval_line_templates
  for select
  using (tenant_id = public.auth_tenant_id() and owner_id = (select auth.uid()));

drop trigger if exists approval_documents_set_updated_at on public.approval_documents;
create trigger approval_documents_set_updated_at
  before update on public.approval_documents
  for each row execute function public.tg_set_updated_at();

drop trigger if exists approval_line_templates_set_updated_at on public.approval_line_templates;
create trigger approval_line_templates_set_updated_at
  before update on public.approval_line_templates
  for each row execute function public.tg_set_updated_at();

notify pgrst, 'reload schema';
