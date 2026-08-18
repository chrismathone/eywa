-- 0216a — 전자결재 v3: 양식 재편(품의서·지출결의서·수입결의서) + 전결·후결·대결
--
-- 원장(2026-08-18): *"업무연락은 필요없고 지출결의서, 품의서, 수입결의서 이정도면 될듯"* +
-- *"전결, 후결, 대결, 반려 이런 기능 있음? 없으면 만들어줘"* (반려는 기존에 있음).
--
-- 🔑 **이 파일이 0215a를 대체한다**(0215a는 프로덕션 적용 전 — 실측 2026-08-18: 표 404, 문서 0건).
--    원장은 **0216a만** 실행하면 된다. 멱등이라 0215a를 실행했던 DB에 돌려도 무해하다.
--
-- 양식(문서번호 접두): 휴가신청서(휴가-) · 품의서(품의-) · 지출결의서(지출-) · 수입결의서(수입-)
--   · `approval_basic_forms`   — 품의서(본문뿐)
--   · `approval_expense_forms` — 지출결의서(금액·지출일·분류 = 컬럼, B2)
--   · `approval_income_forms`  — 수입결의서(지출의 거울 — 금액·수입일·분류)
--   ⚠️ 지출·수입결의서는 기존 /billing 장부와 **별개**이며 재무 집계에 닿지 않는다(통합은 추후 결정).
--
-- 특수 결재(approval_steps.decision 확장 + acted_by):
--   · 전결(final)          — 그 칸에서 문서를 **즉시 승인 종결**. 남은 칸은 skipped(생략).
--   · 후결 대기(deferred)  — 앞 결재자가 부재라 **다음 사람이 먼저 결재**하며 건너뛴 칸.
--     부재자가 나중에 '후결 확인'하면 post_approved(후결). 문서 진행·종결과 무관한 사후 확인이다
--     (하이웍스 후열 '확인'과 같은 의미 — 확인만 있고 사후 반려는 없다: 문서는 이미 진행됐다).
--   · 대결(acted_by)       — 부재자 **대신** 결재한 실제 처리자. 도장에 '대결' + 처리자 이름.
--     v1 대결 권한 = 원장(master). 부재 설정·대결자 사전 지정은 필요해지면 확장(users.absent 등).
--
-- ⚠️ RLS는 0213a 규약 그대로(읽기 = auth_can_read_approval_doc 하나, [[#109]] / 쓰기 = 서버 액션).
-- 롤백: drop table approval_income_forms, approval_expense_forms, approval_basic_forms;
--       steps decision check를 0213a 버전으로, acted_by drop, form check를 'leave'만으로.
set local statement_timeout = '60s';

-- ── 문서 껍데기의 양식 목록 = 4종(업무연락 없음 — 문서 0건 실측이라 흔적 없이 뺀다) ──
alter table public.approval_documents
  drop constraint if exists approval_documents_form_valid;
alter table public.approval_documents
  add constraint approval_documents_form_valid
  check (form_type in ('leave', 'proposal', 'expense', 'income'));

-- ── 결재란 확장: 특수 결재 ───────────────────────────────────────────────────
alter table public.approval_steps
  drop constraint if exists approval_steps_decision_valid;
alter table public.approval_steps
  add constraint approval_steps_decision_valid
  check (decision in ('pending', 'approved', 'rejected', 'final', 'deferred', 'post_approved', 'skipped'));

-- 대결 실제 처리자(null = 본인이 결재). 계정 삭제 시 기록 보존을 위해 set null.
alter table public.approval_steps
  add column if not exists acted_by uuid references public.users(id) on delete set null;

comment on column public.approval_steps.decision is
  'pending 대기 · approved 승인 · rejected 반려 · final 전결(즉시 종결) · deferred 후결 대기(건너뜀) · post_approved 후결 확인 · skipped 전결로 생략. 0216a';
comment on column public.approval_steps.acted_by is
  '대결 실제 처리자(부재자 대신 결재한 사람). null = 칸의 결재자 본인. v1 대결 권한 = 원장(master). 0216a';

-- ── 품의서 상세(본문뿐) ──────────────────────────────────────────────────────
create table if not exists public.approval_basic_forms (
  document_id uuid primary key references public.approval_documents(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- 본문(리치 텍스트 HTML). 저장 전 서버 sanitizeRichHtml + 렌더 직전 재통과(이중 방어).
  body_html text not null default ''
);

comment on table public.approval_basic_forms is
  '품의서 상세(결재 문서 1:1) — 본문 하나. 0216a(0215a 대체 — 당시 업무연락과 공용이었으나 업무연락 폐기).';

create index if not exists approval_basic_forms_tenant_idx
  on public.approval_basic_forms (tenant_id);

-- ── 지출결의서 상세 ──────────────────────────────────────────────────────────
create table if not exists public.approval_expense_forms (
  document_id uuid primary key references public.approval_documents(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  amount numeric(12, 0) not null
    constraint approval_expense_forms_amount_positive check (amount > 0),
  spend_date date not null,
  -- 분류 — 기존 /billing 지출과 같은 어휘(인건비·운영비·매입·마케팅·기타). 실운영 통합 대비.
  -- check로 잠그진 않는다(분류 어휘의 주인은 billing쪽).
  category text not null default '기타',
  body_html text not null default ''
);

comment on table public.approval_expense_forms is
  '지출결의서 상세(결재 문서 1:1). 기존 /billing 지출(expenses)·expense_requests와 별개이며 재무 집계에 닿지 않는다(통합 여부는 추후 결정). 0216a';

create index if not exists approval_expense_forms_tenant_idx
  on public.approval_expense_forms (tenant_id, spend_date);

-- ── 수입결의서 상세(지출의 거울) ─────────────────────────────────────────────
create table if not exists public.approval_income_forms (
  document_id uuid primary key references public.approval_documents(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  amount numeric(12, 0) not null
    constraint approval_income_forms_amount_positive check (amount > 0),
  income_date date not null,
  -- 분류 — 수강료는 수납관리 장부 소관이라 여기 안 온다(수강료 외 수입용 결의서).
  -- 어휘는 파일럿 중 원장 확정 대상(기본 '기타'라 어떤 값도 막지 않는다).
  category text not null default '기타',
  body_html text not null default ''
);

comment on table public.approval_income_forms is
  '수입결의서 상세(결재 문서 1:1) — 수강료 외 수입(교재 판매·특강 등) 승인용. 수납관리 장부·재무 집계와 별개. 0216a';

create index if not exists approval_income_forms_tenant_idx
  on public.approval_income_forms (tenant_id, income_date);

-- ── RLS — 0213a와 같은 규약 ──────────────────────────────────────────────────
alter table public.approval_basic_forms enable row level security;
alter table public.approval_expense_forms enable row level security;
alter table public.approval_income_forms enable row level security;

drop policy if exists approval_basic_forms_read on public.approval_basic_forms;
create policy approval_basic_forms_read on public.approval_basic_forms
  for select
  using (tenant_id = public.auth_tenant_id() and public.auth_can_read_approval_doc(document_id));

drop policy if exists approval_expense_forms_read on public.approval_expense_forms;
create policy approval_expense_forms_read on public.approval_expense_forms
  for select
  using (tenant_id = public.auth_tenant_id() and public.auth_can_read_approval_doc(document_id));

drop policy if exists approval_income_forms_read on public.approval_income_forms;
create policy approval_income_forms_read on public.approval_income_forms
  for select
  using (tenant_id = public.auth_tenant_id() and public.auth_can_read_approval_doc(document_id));

notify pgrst, 'reload schema';
