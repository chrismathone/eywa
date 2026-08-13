-- 0205a — 급여명세서(프리랜서 강의용역수수료 명세서) 저장소
--
-- 원장 방향(2026-08-13): *"급여 명세서 자동 발행"* — 지금까지 구글시트
-- `프리랜서 강의용역수수료 명세서`(문서 1Uh7mbje…)로 손수 만들던 명세서를 eywa가 뽑는다.
--
-- 그 시트는 **순수 집계기**였다. 값을 네 군데서 끌어온다:
--   ① 프리랜서 리스트           — 주민번호·은행·계좌·계약형태·부서·경력·입사일·계약기간·회사명
--   ② 강사별 출석부 시트         — 수업료 총액·수업인원·퇴원생·비율표
--   ③ 프리랜서 선생님 기타 참고  — '내신분석'(= **강사별 블로그 작성일**)·누적수업인원·월평균
--   ④ 별도 '급여 정보' 문서      — 인센티브·기타공제
-- eywa는 ②를 이미 계산하고(0199a 티어 정산, 4인 시트 대비 10원 미만 검증), ①의 대부분도
-- 가지고 있다(users·staff_contracts·academy_documents.form_data). **없는 것은 ③·④뿐**이라
-- 이 표는 딱 그 빈칸 + 발행 스냅샷만 담는다.
--
-- 🔴 왜 금액을 저장하는가(계산으로 두지 않고): 명세서는 **발행 시점에 동결**돼야 한다.
--    출결을 나중에 고치면 이미 지급·서명한 명세서의 금액이 조용히 바뀐다. 그래서
--    `status='issued'`가 되는 순간 `print_payload`에 그 시점 값 전체를 박는다
--    (consultation_ai_analysis.print_payload와 같은 동결 규약).
--    `draft`인 동안에는 payload를 안 쓰고 매번 새로 계산한다.
--
-- 🔴 비율 패널티(블로그 미작성 −2%p)를 **여기 저장하되 기본값은 0**이다. 원장 확인 사항:
--    "8월 시트 비율은 아직 미설정일 수 있음" — 월이 끝나기 전에 패널티를 박으면 과소지급이 된다.
--    `users.commission_rates`(계약 비율)는 **건드리지 않는다** — 이건 그 달에만 얹는 조정이다.
--
-- ⚠️ 순수 가산 — 새 표 하나뿐이고 기존 표·컬럼은 손대지 않는다. 앱은 이 표가 없어도
--    동작해야 한다([[#95]] expand/contract: 조회 실패 = '조정 없음'으로 접고 명세서는 계산으로 뜬다).
-- 롤백: drop table public.payslips;
set local statement_timeout = '60s';

create table if not exists public.payslips (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- 강사(users.id). 계정이 지워지면 명세서도 함께 지운다(귀속 대상이 사라진 명세서는 의미가 없다).
  user_id uuid not null references public.users(id) on delete cascade,
  period text not null                       -- 'YYYY-MM' (급여 귀속월 = 근무월)
    constraint payslips_period_format check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),

  -- ── ④ 월별 수동 입력 (시트 '급여 정보' 문서에 있던 값) ──────────────────────
  incentive numeric(12, 0) not null default 0
    constraint payslips_incentive_nonneg check (incentive >= 0),
  -- ⚠️ 시트 수식(D9)상 기타공제는 **과세표준을 먼저 줄인다**: 소득세 = (지급총액 − 기타공제) × 3.3%.
  other_deduction numeric(12, 0) not null default 0
    constraint payslips_other_deduction_nonneg check (other_deduction >= 0),

  -- ── ③ 블로그(명세서 표기 '내신분석') ────────────────────────────────────────
  -- 시트 셀이 날짜 하나가 아니라 자유 텍스트인 실측이 있어("4/10,14") date가 아니라 text다.
  blog_written_on text,
  -- 그 달에만 적용할 배분율 차감(포인트). 미작성 관행값 2.0 — 단 **기본은 0**(월중 확정 금지).
  rate_penalty_points numeric(4, 1) not null default 0
    constraint payslips_penalty_range check (rate_penalty_points >= 0 and rate_penalty_points <= 100),
  rate_penalty_reason text,

  memo text,

  -- ── 발행 상태 ───────────────────────────────────────────────────────────────
  status text not null default 'draft'
    constraint payslips_status_valid check (status in ('draft', 'issued')),
  issued_at timestamptz,
  issued_by uuid references public.users(id) on delete set null,
  -- 발행 시점 동결 스냅샷(금액·지표·신상 전부). draft면 null이고 화면이 매번 계산한다.
  print_payload jsonb,
  -- 발행했는데 스냅샷이 없으면 "동결됐다"는 약속이 거짓이 된다 — DB에서 막는다.
  constraint payslips_issued_has_payload
    check (status <> 'issued' or (print_payload is not null and issued_at is not null)),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id, period)
);

comment on table public.payslips is
  '급여명세서(프리랜서 강의용역수수료) — 월별 수동 조정(인센티브·기타공제·블로그 패널티) + 발행 시점 동결 스냅샷. 금액 계산 자체는 0199a 티어 정산이 단일 소스. 원장 전용. 0205a';
comment on column public.payslips.blog_written_on is
  '명세서 ''내신분석'' 칸 — 실제로는 강사별 블로그 작성일. 시트가 자유 텍스트도 담아("4/10,14") date가 아닌 text. 빈 값 = 미작성.';
comment on column public.payslips.rate_penalty_points is
  '그 달에만 적용할 배분율 차감(%p, 비율 곱이 아님). 블로그 미작성 관행값 2.0. users.commission_rates는 계약 비율이라 건드리지 않는다.';
comment on column public.payslips.print_payload is
  '발행(issued) 시점 동결 스냅샷 — 출결을 나중에 고쳐도 이미 서명된 명세서가 바뀌지 않게. draft면 null.';

create index if not exists payslips_tenant_idx on public.payslips (tenant_id);
create index if not exists payslips_tenant_period_idx on public.payslips (tenant_id, period);

alter table public.payslips enable row level security;

-- master(원장)만 읽고 쓴다 — 명세서는 급여 PII 그 자체다(0199a salary_tiers·0130a와 동일 규율).
-- ⚠️ 게이트 함수를 맨몸으로 쓰지 않고 `(select …)`로 감싼다([[#91]] InitPlan — 행마다 호출 방지).
drop policy if exists payslips_master_all on public.payslips;
create policy payslips_master_all on public.payslips
  for all
  using (
    tenant_id = public.auth_tenant_id()
    and (select exists (
      select 1 from public.users u
      where u.id = (select auth.uid()) and u.system_role = 'master' and u.tenant_id = public.auth_tenant_id()
    ))
  )
  with check (
    tenant_id = public.auth_tenant_id()
    and (select exists (
      select 1 from public.users u
      where u.id = (select auth.uid()) and u.system_role = 'master' and u.tenant_id = public.auth_tenant_id()
    ))
  );

drop trigger if exists payslips_set_updated_at on public.payslips;
create trigger payslips_set_updated_at
  before update on public.payslips
  for each row execute function public.tg_set_updated_at();

notify pgrst, 'reload schema';
