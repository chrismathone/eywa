-- 0210a — 휴가(연차) 신청 + 전자결재
--
-- 원장 방향(2026-08-14): 연차를 **법정 기준으로 자동 생성**하고, 직원이 자기 아이디로 신청하면
-- 부원장·경리팀·원장&대표에게 **전자결재**가 뜬다. 잔여 연차를 넘으면 **신청 자체가 안 된다**.
--
-- 🔑 **부여(연차 개수)는 이 표에 없다.** 입사일(users.hire_date)에서 계산한다
--    (`src/features/leave/accrual.ts`, 순수함수+단위테스트 36건). 적립 행을 쌓으면 매달 배치가 필요하고
--    배치가 한 번 빠지면 그 사람 연차만 조용히 틀린다 — 입사일에서 도출하면 언제 조회해도 같은 답이고,
--    입사일을 정정하는 순간 소급해서 맞는다. 여기 저장하는 건 **신청·결재라는 사실**뿐이다.
--
-- 🔴 다만 **처리된 건의 근거는 동결한다**(`period_start`·`period_end`·`granted_days`). 입사일이 나중에
--    정정되면 계산식 결과가 바뀌는데, 이미 승인·반려된 건의 "그때 잔여가 몇이었나"까지 흔들리면
--    결재 근거가 사후에 달라진다(payslips.print_payload와 같은 동결 규약).
--
-- 결재 모델 = **병렬 결재**: 결재선 전원(신청자 본인 제외)에게 즉시 뜨고, 전원 승인 시 승인 확정,
--   한 명이라도 반려하면 즉시 반려. 순차(부원장→경리팀→원장)가 아닌 이유는 그 단계 구분이 아직
--   조직도로 모델링돼 있지 않아서다 — 단계가 필요해지면 `leave_approvals.step`으로 확장(컬럼 준비됨).
--   ⚠️ 결재선은 **신청 시점에 행으로 동결**한다(명단이 바뀌어도 진행 중인 건의 결재자가 바뀌지 않게).
--
-- ⚠️ 쓰기는 **서버 액션(service_role)만** 한다 — authenticated insert/update 정책을 의도적으로 두지
--    않았다(#92 규칙대로 명시). 이유: ① 잔여 초과 거절이 서버 계산이라 클라가 행을 직접 만들 수 있으면
--    규칙을 우회한다 ② 결재 확정(전원 승인 집계)은 원자적 판단이라 한 곳에서만 해야 한다.
--    읽기는 RLS로 격리한다(본인 것 / 내가 결재자인 건 / master).
-- 🔴 **`staff_leaves`(0017)와 겹친다 — 파일럿 동안은 일부러 따로 둔다.** 그쪽은 ijw LeaveManagement
--    이식본으로 사무실이 직원 대신 등록·승인하는 단일 결재 표이고(연차 부여·잔여·반려 상태·다중 결재선이
--    전부 없다), **프로덕션 실행 0행**(2026-08-14 실측)이다. 그런데도 지금 통합하지 않는 이유는
--    `staff_leaves`가 **운영실 '오늘 할 일' 시그널**(dashboard/action-signals.ts·today-actions.ts)과
--    직원관리 버튼 3곳에 물려 있어서다 — 파일럿 테스트 신청이 원장 운영실에 "할 일"로 튀면 안 된다.
--    ⚠️ 파일럿을 끝내고 전 직원에게 열 때 **반드시 하나로 합칠 것**: 0행이라 옮길 데이터가 없으므로
--    ① 직원관리 '휴가 관리' 버튼 3곳 → /leave ② 운영실 시그널 → leave_requests(status='pending')
--    ③ staff_leaves + payroll/{actions,queries}의 휴가 함수 폐기. 안 합치면 휴가 화면이 둘이 된다.
-- ⚠️ 순수 가산 — 표 둘만 새로 만들고 기존 표·컬럼은 손대지 않는다([[#95]] expand/contract: 앱은 이 표가
--    없어도 죽지 않는다 — 조회 실패 시 화면이 "준비 중" 안내로 접힌다. 노출도 파일럿 2명뿐).
-- 롤백: drop table public.leave_approvals; drop table public.leave_requests;
set local statement_timeout = '60s';

create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- 신청자. 계정이 지워지면 신청서도 함께(귀속 대상이 없는 신청은 의미가 없다).
  user_id uuid not null references public.users(id) on delete cascade,

  -- 'annual' = 연차(하루 단위) | 'half' = 반차(0.5일, 하루만). 라벨은 코드가 단일 소스(types.ts).
  leave_kind text not null default 'annual'
    constraint leave_requests_kind_valid check (leave_kind in ('annual', 'half')),
  start_date date not null,
  end_date date not null,
  constraint leave_requests_range_ordered check (end_date >= start_date),
  -- 차감 일수. 반차 0.5 때문에 정수가 아니다. 계산은 countLeaveDays(순수함수) 단일 소스.
  days numeric(4, 1) not null
    constraint leave_requests_days_positive check (days > 0),
  reason text,

  -- ── 차감 근거 동결(신청 시점 계산 결과) ────────────────────────────────────
  period_start date not null,
  period_end date not null,
  granted_days numeric(4, 1) not null
    constraint leave_requests_granted_nonneg check (granted_days >= 0),

  -- ── 상태 ───────────────────────────────────────────────────────────────────
  -- ⚠️ '자동반려' 상태는 없다(원장 2026-08-14: *"자동반려 필요없고 잔여없으면 신청 자체를 못하자나"*).
  --    잔여를 넘는 신청은 **행이 만들어지기 전에** 서버 액션이 거절한다 → 여기 남는 건 사람이 낸 신청뿐.
  status text not null default 'pending'
    constraint leave_requests_status_valid check (status in ('pending', 'approved', 'rejected', 'canceled')),
  decided_at timestamptz,
  decision_note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.leave_requests is
  '휴가(연차·반차) 신청 1건 + 처리 결과. 연차 부여 개수는 저장하지 않는다 — users.hire_date에서 법정 기준으로 계산(features/leave/accrual.ts). period_*/granted_days는 신청 시점 근거 동결. 0210a';
comment on column public.leave_requests.granted_days is
  '신청 시점에 그 연차 구간으로 부여돼 있던 일수(동결). 입사일이 나중에 정정돼도 이미 처리된 건의 잔여 근거가 흔들리지 않게 남긴다.';

create index if not exists leave_requests_tenant_user_idx
  on public.leave_requests (tenant_id, user_id, start_date desc);
create index if not exists leave_requests_tenant_status_idx
  on public.leave_requests (tenant_id, status, created_at desc);

-- ── 결재선(병렬) ─────────────────────────────────────────────────────────────
create table if not exists public.leave_approvals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  request_id uuid not null references public.leave_requests(id) on delete cascade,
  approver_id uuid not null references public.users(id) on delete cascade,
  -- 병렬 결재라 지금은 전부 1. 순차(부원장→경리팀→원장)가 필요해지면 이 값으로 단계를 나눈다.
  step smallint not null default 1,
  decision text not null default 'pending'
    constraint leave_approvals_decision_valid check (decision in ('pending', 'approved', 'rejected')),
  decided_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  -- 한 사람이 같은 신청서에 두 칸을 가질 수 없다(중복 결재란 = 집계가 틀어진다).
  unique (request_id, approver_id)
);

comment on table public.leave_approvals is
  '휴가 신청 1건의 결재선 한 칸(결재자 1인). 신청 시점 명단을 행으로 동결 — 명단이 바뀌어도 진행 중인 건의 결재자는 그대로. 0210a';

create index if not exists leave_approvals_approver_idx
  on public.leave_approvals (tenant_id, approver_id, decision);
create index if not exists leave_approvals_request_idx
  on public.leave_approvals (request_id);

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- 읽기만 정책으로 연다(쓰기는 위 주석대로 service_role 서버 액션 전용).
-- ⚠️ 게이트 함수는 `(select …)`로 감싼다([[#91]] InitPlan — 행마다 호출 방지).
alter table public.leave_requests enable row level security;
alter table public.leave_approvals enable row level security;

-- 본인 신청서
drop policy if exists leave_requests_self_read on public.leave_requests;
create policy leave_requests_self_read on public.leave_requests
  for select
  using (tenant_id = public.auth_tenant_id() and user_id = (select auth.uid()));

-- 내가 결재자로 걸린 신청서(전자결재함)
drop policy if exists leave_requests_approver_read on public.leave_requests;
create policy leave_requests_approver_read on public.leave_requests
  for select
  using (
    tenant_id = public.auth_tenant_id()
    and exists (
      select 1 from public.leave_approvals a
      where a.request_id = leave_requests.id and a.approver_id = (select auth.uid())
    )
  );

-- 원장(master) — 학원 전체 휴가 현황
drop policy if exists leave_requests_master_read on public.leave_requests;
create policy leave_requests_master_read on public.leave_requests
  for select
  using (
    tenant_id = public.auth_tenant_id()
    and (select exists (
      select 1 from public.users u
      where u.id = (select auth.uid()) and u.system_role = 'master' and u.tenant_id = public.auth_tenant_id()
    ))
  );

-- 결재란 — 내가 결재자이거나, 내 신청서의 결재선이거나, master
drop policy if exists leave_approvals_visible_read on public.leave_approvals;
create policy leave_approvals_visible_read on public.leave_approvals
  for select
  using (
    tenant_id = public.auth_tenant_id()
    and (
      approver_id = (select auth.uid())
      or exists (
        select 1 from public.leave_requests r
        where r.id = leave_approvals.request_id and r.user_id = (select auth.uid())
      )
      or (select exists (
        select 1 from public.users u
        where u.id = (select auth.uid()) and u.system_role = 'master' and u.tenant_id = public.auth_tenant_id()
      ))
    )
  );

drop trigger if exists leave_requests_set_updated_at on public.leave_requests;
create trigger leave_requests_set_updated_at
  before update on public.leave_requests
  for each row execute function public.tg_set_updated_at();

notify pgrst, 'reload schema';
