-- 0215a — 전자결재 양식 3종 추가: 품의서 · 지출결의서 · 업무연락 (원장 2026-08-18 — *"추가로 다른
-- 기안 몇가지"*, 이어 *"테스트용이라고 막 넣지 말고 실제 오픈이라 생각하고"* → 실오픈 기준으로 만든다)
--
-- 0213a의 양식 중립 구조 그대로 — 문서 껍데기(approval_documents)는 손대지 않고 **상세 표만 더한다**:
--   · `approval_basic_forms`   — 품의서·업무연락 공용(본문 리치 텍스트 하나뿐이라 표를 안 가른다.
--     양식 구분은 approval_documents.form_type이 이미 담당 — 같은 모양의 표 두 개는 중복이다)
--   · `approval_expense_forms` — 지출결의서(금액·지출일은 **컬럼**이어야 나중에 합산·기간 필터가 된다, B2)
--
-- ⚠️ 전자결재 지출결의서는 **기존 /billing 지출·expense_requests와 별개**다(그쪽은 강사 제출→사무실
--    결재 실운영, 이쪽은 전자결재 파일럿 테스트). 파일럿을 끝내고 실운영으로 전환할 때 하나로 합칠지
--    결정한다 — 그전까지 이 표의 금액은 어떤 재무 집계에도 닿지 않는다.
-- ⚠️ RLS 교차 조회는 0213a의 `auth_can_read_approval_doc` 함수 하나로 계속 모은다([[#109]] — 정책이
--    서로의 표를 직접 조회하면 무한 재귀 42P17). 쓰기는 서버 액션(service_role) 전용.
-- 롤백: drop table approval_expense_forms, approval_basic_forms;
--       + form_type check를 0213a 버전('leave'만)으로 되돌리기.
set local statement_timeout = '60s';

-- ── 문서 껍데기의 양식 목록 확장 ─────────────────────────────────────────────
alter table public.approval_documents
  drop constraint if exists approval_documents_form_valid;
alter table public.approval_documents
  add constraint approval_documents_form_valid
  check (form_type in ('leave', 'proposal', 'expense', 'memo'));

-- ── 품의서·업무연락 상세(본문뿐) ─────────────────────────────────────────────
create table if not exists public.approval_basic_forms (
  document_id uuid primary key references public.approval_documents(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- 본문(리치 텍스트 HTML). 저장 전 서버 sanitizeRichHtml + 렌더 직전 재통과(이중 방어).
  body_html text not null default ''
);

comment on table public.approval_basic_forms is
  '품의서·업무연락 상세(결재 문서 1:1) — 본문 하나뿐이라 두 양식이 공유한다(양식 구분은 approval_documents.form_type). 0215a';

create index if not exists approval_basic_forms_tenant_idx
  on public.approval_basic_forms (tenant_id);

-- ── 지출결의서 상세 ──────────────────────────────────────────────────────────
create table if not exists public.approval_expense_forms (
  document_id uuid primary key references public.approval_documents(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  amount numeric(12, 0) not null
    constraint approval_expense_forms_amount_positive check (amount > 0),
  spend_date date not null,
  -- 분류 — 기존 /billing 지출과 같은 어휘(인건비·운영비·매입·마케팅·기타)를 쓴다. 나중에 실운영
  -- 통합 시 그대로 옮겨 앉게 하기 위해서다. check로 잠그진 않는다(분류 어휘의 주인은 billing쪽).
  category text not null default '기타',
  body_html text not null default ''
);

comment on table public.approval_expense_forms is
  '지출결의서 상세(결재 문서 1:1). 기존 /billing 지출(expenses)·expense_requests와 별개이며 재무 집계에 닿지 않는다(파일럿 종료 시 통합 여부 결정). 0215a';

create index if not exists approval_expense_forms_tenant_idx
  on public.approval_expense_forms (tenant_id, spend_date);

-- ── RLS — 0213a와 같은 규약(읽기 = 문서 열람 함수, 쓰기 = service_role 전용) ──
alter table public.approval_basic_forms enable row level security;
alter table public.approval_expense_forms enable row level security;

drop policy if exists approval_basic_forms_read on public.approval_basic_forms;
create policy approval_basic_forms_read on public.approval_basic_forms
  for select
  using (tenant_id = public.auth_tenant_id() and public.auth_can_read_approval_doc(document_id));

drop policy if exists approval_expense_forms_read on public.approval_expense_forms;
create policy approval_expense_forms_read on public.approval_expense_forms
  for select
  using (tenant_id = public.auth_tenant_id() and public.auth_can_read_approval_doc(document_id));

notify pgrst, 'reload schema';
