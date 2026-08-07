-- 0189a — 세션 기간(운영 기간) — 학원이 정한 과목별 수업 구간 (2026-08-07).
--
-- 배경(원장 2026-08-07): *"우리 학원은 세션으로 운영되기 때문."*
-- 지금까지 eywa의 모든 기간 단위는 **달력월**(YYYY-MM, 1일~말일) 고정이었다
-- (`plan.ts monthRange`, `invoices.period`, `payroll_records.period`, `class_sheet_goals.period_start`).
-- 실제 운영은 그렇지 않다 — **세션 = 월~금이 각각 4회씩 들어가는 구간**이고, 공휴일로 빠진 요일은
-- 다음 달로 넘어가서라도 4회를 채운다. 그래서 "2월 세션이 3/5까지" 같은 일이 정상이다.
-- 구 출석부(D:\attendance)에 같은 모델(`session_periods`)이 있었으나 그 Supabase 프로젝트는
-- 삭제되어(2026-08-07 DNS 소멸 확인) **데이터는 복구 불가** — 원장이 연간계획표를 보고 재입력한다.
--
-- ── 이름 주의 ──────────────────────────────────────────────────────────────
-- eywa엔 이미 'session'이 **두 가지 뜻**으로 있고 둘 다 돈 계산에 닿는다:
--   · `attendance_records.session_units` (0115a) = **시수**(출석 한 칸이 정규 수업 몇 회분인가)
--   · `invoice_session_terms.planned/confirmed_sessions` (0102a) = **회차**(청구서 한 줄의 N회)
-- 여기에 `session_periods`를 또 만들면 `grep session`이 무의미해지고, 그 셋은 전부 급여·청구
-- 코드라 잘못 잡은 grep 한 번이 곧 돈 사고다. → 테이블명은 **operating_periods**.
-- 화면 라벨만 원장 어휘 그대로 "세션"을 쓴다("2026년 3월 세션 (3/6~4/2)").
--
-- ── 구 출석부에서 **일부러 안 가져온 것** ──────────────────────────────────
-- ① `ranges jsonb`(복수 구간): 구 모델은 주별로 끊어 저장했지만 **집계는 어차피 min~max 통기간**
--    하나만 봤다(D:\attendance\src\lib\sessionUtils.ts:11-20). 화면 확장 함수는 별도 계산이라
--    "표엔 안 보이는데 급여엔 잡히는 출석"이 가능했다. 원장 설명도 단일 구간 모델이다 —
--    *"주말은 그 사이에 그냥 이어지지만 세션의 일부로 계산하는 게 편하므로 편입"*.
--    → **start_date~end_date 단일 구간**으로 못박아 그 어긋남 클래스를 없앤다.
--    세션 중간의 휴원은 기존 학원설정 `operations.holidays`가 담당한다(공휴일=세션에서 제외,
--    단 출석부에는 날짜를 표기하되 휴일 서식 — 원장 2026-08-07).
-- ② `sessions int default 12`(회차): 구 앱은 저장할 때마다 12를 하드코딩했고
--    (SessionSettingsModal.tsx:305) 계산 어디서도 안 읽었다 = write-only-orphan.
--    eywa는 `planTermsForWindow`가 요일·공휴일로 회차를 산출하고 사람이 확정한다(불변규칙 N1).
--    "월~금 각 4회" 규칙은 DB 제약이 아니라 **앱의 검산 경고**로 넣는다(학원 사정으로 3회인
--    달을 DB가 거부하면 안 된다).
--
-- ── class_id가 nullable인 이유 ────────────────────────────────────────────
-- 원장은 "과목·반별로 다른 날"이라 했으나 구 모델엔 반 축이 없었고, 연간계획표(사진)도 과목 단위다.
-- `class_id IS NULL` = 그 과목의 기본값(= 구 모델과 1:1), 값이 있으면 그 반만의 예외.
-- 1단계는 NULL 행만 입력한다. **나중에 컬럼을 더하려면 unique·EXCLUDE를 둘 다 갈아야 하는데
-- 그때는 이미 실데이터가 들어 있다** — 그래서 지금 열어 둔다(행은 안 만든다).
--
-- ── 겹침 금지(GiST EXCLUDE) ───────────────────────────────────────────────
-- 구 모델엔 제약이 0이라 3월 세션 끝(4/2)과 4월 세션 시작(4/1)이 겹쳐도 통과했고, 각 달 집계가
-- 서로를 모르므로 **같은 날이 3월분·4월분 급여에 두 번** 들어갈 수 있었다. 여기서 원천 차단한다.
-- ⚠️ 실제로 겹치게 운영해야 하는 상황이 나오면 이 제약만 drop 하면 된다(테이블·데이터 무관).
-- btree_gist는 0001a에서 이미 활성(enrollments_no_overlap 선례).
--
-- ── RLS: 0157a(ECS) 패턴 = 정책 0개 + service_role 전용 ───────────────────
-- 이 표는 출석부·청구·급여·ECS가 **전부** 읽는다. 여기에 역할 게이트를 걸면 한 역할만 빠져도
-- 그 사람 화면이 통째로 달력월로 조용히 떨어진다(#92 fail-closed 락아웃). PostgREST 직결을
-- 아예 막고 서버(admin client)만 읽게 하면 그 위험이 사라진다.
-- ⚠️ **RLS 우회이므로 서버 코드가 tenant_id 필터를 반드시 직접 건다**(loadPeriodDefs 단일 진입점).
-- ⚠️ '의도적 제외'를 여기 적어 둔다 — 안 적힌 테이블은 닫힌 걸로 오인된다(#92).
--
-- 이 마이그레이션은 **새 테이블뿐**이라 옛 앱에서 완전히 무해하다(읽는 코드가 0).
-- 앱은 이 표가 없어도 달력월로 정상 동작하도록 짠다(#95 expand/contract) → 적용 순서 자유.

create table if not exists operating_periods (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  subject_key text not null,            -- 학원설정 subjects[].key (운영 enum 하드코딩 금지)
  class_id uuid,                        -- null = 그 과목의 기본값 / 값 = 그 반만의 예외
  label_year int not null check (label_year between 2000 and 2100),
  label_month int not null check (label_month between 1 and 12),
  start_date date not null,             -- 통기간 시작(포함) — 주말 포함, 파생 아닌 저장값
  end_date date not null,               -- 통기간 끝(포함)
  note text check (char_length(note) <= 200),
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint operating_periods_range_ck check (end_date >= start_date)
);

-- 반이 지워지면 그 반 전용 예외도 함께 사라진다(과목 기본값 행은 class_id가 null이라 무관).
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'operating_periods_class_fk') then
    alter table operating_periods
      add constraint operating_periods_class_fk
      foreign key (tenant_id, class_id) references classes (tenant_id, id) on delete cascade;
  end if;
end $$;

-- 한 (과목, 반, 라벨월)에 세션은 최대 1개.
-- ⚠️ 이것이 "한 청구서 한 반에 세션이 둘 붙는" 상황을 원천 차단하는 열쇠다
--    (invoice_session_terms의 unique (tenant, invoice, class)를 그대로 살릴 수 있는 근거).
create unique index if not exists operating_periods_label_uq
  on operating_periods (
    tenant_id,
    subject_key,
    coalesce(class_id, '00000000-0000-0000-0000-000000000000'::uuid),
    label_year,
    label_month
  );

-- 같은 (과목, 반) 안에서 기간이 겹치면 거부. '[]' = 양끝 포함(end_date 당일도 세션이다).
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'operating_periods_no_overlap') then
    alter table operating_periods
      add constraint operating_periods_no_overlap
      exclude using gist (
        tenant_id with =,
        subject_key with =,
        coalesce(class_id, '00000000-0000-0000-0000-000000000000'::uuid) with =,
        daterange(start_date, end_date, '[]') with &&
      );
  end if;
end $$;

-- 조회 패턴: (테넌트, 연도)로 한 해치를 통째 읽어 캐시 → 메모리에서 과목·월 해석.
create index if not exists operating_periods_year_idx
  on operating_periods (tenant_id, label_year);

-- 날짜로 되찾기(어느 세션에 속하는가) — 출석부·검증이 쓴다.
create index if not exists operating_periods_span_idx
  on operating_periods (tenant_id, subject_key, start_date, end_date);

drop trigger if exists trg_operating_periods_updated_at on operating_periods;
create trigger trg_operating_periods_updated_at
  before update on operating_periods
  for each row execute function public.tg_set_updated_at();

-- RLS: 정책 0개(의도) — 0157a와 같은 service_role 전용. 위 헤더 주석 참조.
alter table operating_periods enable row level security;

revoke all on table operating_periods from public, anon, authenticated;
grant all on table operating_periods to service_role;

-- ── 원자 저장 RPC ─────────────────────────────────────────────────────────
-- 한 (과목, 반, 연도)의 12개월을 **통째로 교체**한다. delete + insert를 앱에서 두 번 부르면
-- 그 사이에 실패했을 때 "세션이 통째로 사라진 상태"가 남는다. 게다가 겹침 EXCLUDE 때문에
-- 순서가 강제되므로(기존 행이 있는 채로 새 행을 넣으면 위반) 반드시 한 트랜잭션이어야 한다.
--
-- p_rows 예: '[{"labelMonth":3,"startDate":"2026-03-06","endDate":"2026-04-02"}, …]'
-- 빈 배열 = 그 해 그 과목의 세션을 전부 지움(= 달력월로 복귀).
--
-- ⚠️ 권한: 서버 액션이 admin(service_role)으로만 호출한다. authenticated에 실행권을 주지 않는다
--    — 주면 RLS 정책 0개인 표를 클라가 PostgREST로 직접 갈아엎을 수 있다.
create or replace function public.save_operating_periods(
  p_tenant uuid,
  p_subject text,
  p_class uuid,
  p_year int,
  p_rows jsonb,
  p_user uuid default null
) returns int
language plpgsql
as $$
declare
  v_count int;
begin
  delete from operating_periods
  where tenant_id = p_tenant
    and subject_key = p_subject
    and label_year = p_year
    and coalesce(class_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = coalesce(p_class, '00000000-0000-0000-0000-000000000000'::uuid);

  insert into operating_periods
    (tenant_id, subject_key, class_id, label_year, label_month, start_date, end_date, updated_by)
  select
    p_tenant,
    p_subject,
    p_class,
    p_year,
    (r->>'labelMonth')::int,
    (r->>'startDate')::date,
    (r->>'endDate')::date,
    p_user
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as r;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.save_operating_periods(uuid, text, uuid, int, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.save_operating_periods(uuid, text, uuid, int, jsonb, uuid) to service_role;

comment on table operating_periods is
  '세션 기간(운영 기간) — 학원이 정한 과목별 수업 구간. 달력월이 아니다. UI 라벨은 "세션"(0189a). '
  '주의: session_units(시수)·invoice_session_terms(회차)와 다른 개념이다.';
comment on column operating_periods.class_id is
  'null = 그 과목의 기본값(구 출석부 모델과 1:1). 값 = 그 반만의 예외. 1단계는 null만 입력(0189a).';
comment on column operating_periods.start_date is
  '통기간 시작(포함). 주말은 세션에 편입된다 — 계산 대상은 아니지만 사이에 낀 날이라 구간에 들어간다(원장 2026-08-07).';
comment on column operating_periods.end_date is
  '통기간 끝(포함). 공휴일로 요일이 빠지면 다음 달로 넘어가서라도 월~금 각 4회를 채우므로 라벨월을 넘길 수 있다.';
