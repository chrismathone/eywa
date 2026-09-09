-- 0252a — 연차 **조정 행**(이월·특별휴가·중도 정산 차감)
--
-- 원장 지시 2026-09-08: *"전자결재에서 관리자랑 김예원이 직원들의 연차갯수를 조정해야하는데 해당 기능이
-- 없음"* (관리자 = 박소선·이승엽·김예원).
--
-- 🔑 **부여는 여전히 계산이다.** 0212a 결정(연차는 저장하지 않고 `users.hire_date`에서 계산 —
--    features/leave/accrual.ts)은 그대로 두고, 그 주석이 미리 적어 둔 확장 경로를 그대로 판다:
--    *"이월·특별휴가·중도입사 정산 같은 수기 조정은 표현하지 못한다 — 필요해지면 조정 행
--    (leave_adjustments)을 더해 `granted + 조정`으로 확장할 것."*
--    즉 이 표는 **법정 부여를 대체하지 않고 얹힌다**. 입사일을 고치면 법정분은 여전히 소급해 맞아떨어지고,
--    사람이 손으로 정한 몫만 여기 행으로 남는다(누가·언제·왜가 행에 적힌다).
--
-- 🔑 축 = (직원, 연차 구간). `period_start`는 **leave_forms.period_start와 같은 값**(입사일 기준 1년 구간의
--    시작일)이라 잔여 계산이 한 축에서 더해진다 — 구간이 넘어가면 조정도 함께 리셋된다(이월은 새 구간에
--    새 행으로 적는다. 안 그러면 작년 이월이 영원히 따라다닌다).
--
-- 🔴 **덮어쓰기(UPDATE)가 아니라 행을 쌓는다.** "연차 15 → 18"을 값 하나로 저장하면 왜 바뀌었는지가
--    사라지고, 두 사람이 같은 사람을 동시에 고치면 뒤엣값이 앞엣값을 조용히 삼킨다. 행이면 합이 곧 답이고
--    이력이 곧 근거다(화면은 "총 N일로" 입력을 받아 **차이만** 행으로 적는다).
--
-- 🔴 쓰기 정책을 두지 않는다(0212a/0213a와 같은 이유) — 조정은 **자격을 바꾸는 값**이라 서버 액션
--    (service_role)만 쓴다. 클라가 PostgREST로 자기 행을 만들 수 있으면 연차는 자기 신고제가 된다.
-- ⚠️ 읽기는 **본인 행만** 연다(잔여 표시에 필요). 관리자 화면은 admin 클라이언트 + tenant_id 명시 필터로
--    읽는다([[#104]]) — RLS에 `auth_menu_access('approvals')`를 끌어오면 파일럿 기본값(전 역할 none)에
--    걸려 정작 본인 잔여까지 막힌다([[#92]]).
--
-- 롤백: drop table if exists public.leave_adjustments;
set local statement_timeout = '60s';

create table if not exists public.leave_adjustments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- 조정 대상 직원(휴가 당사자). 기록자는 created_by.
  user_id uuid not null references public.users(id) on delete cascade,

  -- 연차 구간(입사일 기준 1년). leave_forms.period_start와 같은 값이라 한 축에서 합산된다.
  period_start date not null,
  period_end date not null,
  constraint leave_adjustments_period_ordered check (period_end >= period_start),

  -- 가감 일수. 양수 = 이월·특별휴가 부여, 음수 = 차감. 반반차(0.25) 해상도 보존.
  -- 0은 아무 뜻이 없고(사유만 남는 유령 행), 상한은 오타 방어(0 하나 더 붙은 300일).
  days numeric(5, 2) not null
    constraint leave_adjustments_days_nonzero check (days <> 0)
    constraint leave_adjustments_days_bounded check (days >= -100 and days <= 100),

  -- 왜 조정했는가. **필수** — 사유 없는 연차 증감은 나중에 아무도 설명하지 못한다.
  reason text not null constraint leave_adjustments_reason_present check (btrim(reason) <> ''),

  -- 기록한 사람(관리자). 계정이 지워져도 행은 남아야 하므로 set null.
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.leave_adjustments is
  '연차 조정 행(이월·특별휴가·정산 차감). 부여는 users.hire_date에서 계산(accrual.ts)하고 이 표는 그 위에 더해진다 — 잔여 = 법정부여 + 조정합 − 사용 − 결재중. 축은 (직원, 연차 구간). 0252a';
comment on column public.leave_adjustments.days is
  '가감 일수(+부여 / −차감). 덮어쓰지 않고 행을 쌓아 합이 곧 조정값이다.';
comment on column public.leave_adjustments.period_start is
  'leave_forms.period_start와 같은 축(입사일 기준 1년 구간의 시작일) — 구간이 넘어가면 조정도 리셋된다.';

create index if not exists leave_adjustments_user_period_idx
  on public.leave_adjustments (tenant_id, user_id, period_start);

alter table public.leave_adjustments enable row level security;

-- 본인 행만 읽는다(내 연차 현황). 관리자 화면·쓰기는 서버(service_role)에서.
-- ⚠️ `(select auth.uid())`로 감싼 건 행마다 재평가되지 않게 하기 위함([[#91]] InitPlan).
drop policy if exists leave_adjustments_self_read on public.leave_adjustments;
create policy leave_adjustments_self_read on public.leave_adjustments
  for select
  to authenticated
  using (tenant_id = public.auth_tenant_id() and user_id = (select auth.uid()));

-- ── 곁다리 정정: 휴가 일수의 소수 자릿수 ─────────────────────────────────────
-- 🔴 `numeric(4, 1)`은 **반반차(0.25)를 담지 못한다** — Postgres가 자릿수에 맞춰 반올림해 0.3으로 저장한다
--    (0223a가 종류만 열고 컬럼 정밀도를 안 넓힌 자리). 앱은 0.25로 계산하는데 DB는 0.3을 돌려주니
--    쓴 만큼보다 0.05일씩 더 깎여 왔다. 조정(위)이 0.25 단위를 쓰는 이상 같은 왜곡이 `granted_days`
--    (기안 시점 부여 동결값 = 법정 + 조정)에도 그대로 번지므로 여기서 함께 넓힌다.
-- ⚠️ 넓히는 방향이라 기존 값은 그대로 통과한다(축소가 아니다).
alter table public.leave_forms
  alter column days type numeric(5, 2),
  alter column granted_days type numeric(5, 2);

-- 이미 0.3으로 굳은 반반차 행만 제자리로. 반반차의 차감은 `countLeaveDays`가 **항상 0.25**를 내므로
-- (request-days.ts) 0.3은 이 반올림 말고는 생길 수 없는 값이다 — 그래서 정확히 그 행만 고른다.
update public.leave_forms set days = 0.25 where leave_kind = 'quarter' and days = 0.3;

comment on column public.leave_forms.days is
  '차감 일수 — 연차 1일 단위 / 반차 0.5 / 반반차 0.25(0252a에서 numeric(5,2)로 넓힘: numeric(4,1)은 0.25를 0.3으로 반올림했다).';

notify pgrst, 'reload schema';
