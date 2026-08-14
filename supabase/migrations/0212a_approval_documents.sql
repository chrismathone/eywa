-- 0212a — 전자결재(결재 문서) 기반 + 첫 양식 = 휴가신청서
--
-- 원장 방향(2026-08-14): *"이거 이렇게 이상하게 쓰지말고 전자결재 페이지를 만들자. 그중에 휴가를
-- 먼저 사용하는 느낌으로."* → 휴가 전용 표(0210a)를 걷어내고 **양식 중립적인 결재 문서**로 다시 세운다.
-- 표준 전자결재 구성(그룹웨어 관행)을 따른다: 기안 → 결재선 **순차** → 결재대기/상신함/완료함.
--
-- 구조 = 껍데기 + 양식별 상세(supertype/subtype)
--   · `approval_documents` — 문서 1건(문서번호·양식·제목·기안자·상태·현재 단계). 양식이 늘어도 그대로.
--   · `approval_steps`     — 결재선 한 칸(단계 번호·결재자·직함 라벨·판단). 순차라 step_no가 순서다.
--   · `leave_forms`        — 휴가신청서 상세(문서 1:1). 지출결의서를 붙일 땐 `expense_forms`를 더한다.
-- 🔑 상세를 jsonb 한 덩어리로 안 만든 이유: 잔여 연차 계산이 **일수 합산**이라 컬럼이어야 세고 거를 수 있다
--    (B2 — 세거나 집계할 값을 jsonb에 묻으면 결국 전건을 끌어와 JS에서 더하게 된다).
--
-- 🔴 **0210a/0211a의 `leave_requests`·`leave_approvals`를 드롭한다** — 프로덕션 실측 **둘 다 0행**이고
--    (2026-08-14, service_role 카운트) 화면이 뜬 적이 없어 옮길 데이터가 없다. 0210a/0211a 파일은
--    역사 기록으로 남긴다(새 DB는 0210a→0211a→0212a 순으로 적용돼 결국 이 상태로 수렴).
--
-- ⚠️ RLS는 [[#109]] 재발 방지로 **교차 조회를 security definer 함수 하나**(`auth_can_read_approval_doc`)로
--    모은다. 정책이 서로의 표를 직접 조회하면 무한 재귀(42P17)로 표 전체가 안 읽힌다 — 0210a가 그랬다.
-- ⚠️ 쓰기는 서버 액션(service_role) 전용(0210a와 같은 이유: 잔여 검증·단계 진행이 서버 판단).
-- 롤백: drop table leave_forms, approval_steps, approval_documents; drop function auth_can_read_approval_doc(uuid);
set local statement_timeout = '60s';

-- ── 옛 휴가 전용 표 정리(0행) ────────────────────────────────────────────────
drop table if exists public.leave_approvals;
drop table if exists public.leave_requests;
drop function if exists public.auth_is_leave_approver(uuid);
drop function if exists public.auth_is_leave_requester(uuid);

-- ── 결재 문서 ────────────────────────────────────────────────────────────────
create table if not exists public.approval_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- 문서번호 '휴가-2026-0001'. 사람이 부르는 이름이라 표시·검색용이고 판정에는 쓰지 않는다.
  doc_no text not null,
  -- 양식. 늘어날 자리라 check로 좁히되 값 추가는 마이그레이션 한 줄이면 된다.
  form_type text not null
    constraint approval_documents_form_valid check (form_type in ('leave')),
  title text not null,
  drafter_id uuid not null references public.users(id) on delete cascade,

  status text not null default 'pending'
    constraint approval_documents_status_valid check (status in ('pending', 'approved', 'rejected', 'canceled')),
  -- 지금 결재할 차례(순차). 1부터. 완료·반려되면 더 안 움직인다.
  current_step smallint not null default 1,
  submitted_at timestamptz not null default now(),
  completed_at timestamptz,
  -- 마지막 판단 요약(누가 승인/반려했는지 한 줄) — 목록에서 문서를 안 열고도 결말이 보이게.
  outcome_note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 같은 학원 안에서 문서번호는 유일하다(중복이면 서로 다른 문서를 같은 이름으로 부르게 된다).
  unique (tenant_id, doc_no)
);

comment on table public.approval_documents is
  '전자결재 문서 1건(양식 중립). 양식별 상세는 leave_forms 같은 1:1 표에. 결재선은 approval_steps. 0212a';
comment on column public.approval_documents.current_step is
  '순차 결재의 현재 차례(1부터). 이 단계의 결재자만 처리할 수 있다 — 판정의 단일 근거.';

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
  -- 한 사람이 같은 문서에 두 칸을 가질 수 없다(같은 사람에게 두 번 물어보는 결재선은 실수다).
  unique (document_id, approver_id)
);

comment on table public.approval_steps is
  '결재선 한 칸. step_no가 곧 순서이고, 문서의 current_step과 같은 칸만 처리할 수 있다. 기안 시점 명단을 행으로 동결. 0212a';

create index if not exists approval_steps_approver_idx
  on public.approval_steps (tenant_id, approver_id, decision);
create index if not exists approval_steps_document_idx
  on public.approval_steps (document_id, step_no);

-- ── 휴가신청서 상세(양식 1호) ────────────────────────────────────────────────
create table if not exists public.leave_forms (
  document_id uuid primary key references public.approval_documents(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- 휴가 당사자. 기안자와 같지만 별도 컬럼으로 둔다(대리 기안이 생기면 여기가 진실이다).
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
  '휴가신청서 상세(결재 문서 1:1). 연차 부여 일수는 저장하지 않고 users.hire_date에서 계산한다(features/leave/accrual.ts) — period_*/granted_days는 기안 시점 근거 동결. 0212a';

create index if not exists leave_forms_user_period_idx
  on public.leave_forms (tenant_id, user_id, period_start);

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- 🔑 교차 조회는 **이 함수 하나**로 모은다. 정책 안에서 다른 표를 직접 조회하면 그 표의 정책이 또 돌아
--    상호 재귀(42P17)가 난다([[#109]] — 0210a가 그렇게 죽었다). security definer라 함수 안에서는
--    RLS가 다시 걸리지 않아 고리가 끊긴다.
-- ⚠️ 돌려주는 건 **볼 수 있는가(boolean)** 뿐이라 RPC로 직접 불려도 남의 데이터가 새지 않는다.
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
  '전자결재 열람 자격(기안자·결재자·원장) — 정책 안에서 표를 직접 조회하면 상호 재귀(42P17)라 security definer로 모았다. 0212a';

alter table public.approval_documents enable row level security;
alter table public.approval_steps enable row level security;
alter table public.leave_forms enable row level security;

drop policy if exists approval_documents_read on public.approval_documents;
create policy approval_documents_read on public.approval_documents
  for select
  using (tenant_id = public.auth_tenant_id() and public.auth_can_read_approval_doc(id));

drop policy if exists approval_steps_read on public.approval_steps;
create policy approval_steps_read on public.approval_steps
  for select
  using (tenant_id = public.auth_tenant_id() and public.auth_can_read_approval_doc(document_id));

drop policy if exists leave_forms_read on public.leave_forms;
create policy leave_forms_read on public.leave_forms
  for select
  using (tenant_id = public.auth_tenant_id() and public.auth_can_read_approval_doc(document_id));

drop trigger if exists approval_documents_set_updated_at on public.approval_documents;
create trigger approval_documents_set_updated_at
  before update on public.approval_documents
  for each row execute function public.tg_set_updated_at();

notify pgrst, 'reload schema';
