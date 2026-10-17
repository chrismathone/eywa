-- 오늘 수학 채점 결과 보관(역방향 2단계 · 원장 2026-10-17 *"오늘 수학과 연결되어있을때 해당 웹앱에서 어떻게 시험 데이터 등을 받아올지"* → *"2단계부터 진행해"*).
--
-- aywa가 10분마다 오늘 수학에서 끌어온다(`/api/cron/todays-math-results` → 오늘 수학 `/api/integrations/eywa/v2/results`).
-- 오늘 수학은 날짜별 지문을 주고, 지문이 달라진 날만 그날 행 전부를 받아 이 함수가 **그날을 통째로 갈아끼운다**(빠진 행 = 지워진 시험).
-- 한 행 = 오늘 수학 시험 1건 × 학생 1명의 마지막 채점(재채점이면 덮어쓴다). 아직 채점 안 된 시험은 행이 없다.
-- 🔴 결시는 점수·맞은 수가 없다 — 0점으로 적지 않는다(CHECK). 오늘 수학 `scoreRollup.ts`와 같은 규칙.
-- 소비처(다음 단계): 원스크린 수학 행의 일일·확인테스트 빈칸 채우기 · 성적관리 월말평가 칸 · 원생 상세 '오늘 수학' 탭.
--
-- 새 표 둘 + 서버 전용 함수 하나. 기존 표·함수는 그대로. 🔴 정책 없는 RLS = 의도적이다 — 서버 키(앱 admin client)로만 읽고 쓴다
-- ([[#92]] · [[#104]] — 읽는 화면은 서버에서 지점 id로 거른다). 앱보다 먼저 적용한다(표가 없으면 동기화는 "아직 준비 전"으로 건너뛴다).
begin;
set local lock_timeout = '5s';

create table if not exists public.todays_math_test_results (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source_test_id uuid not null,           -- 오늘 수학 시험 id
  student_id uuid not null,               -- aywa 학생(오늘 수학이 연결로 들고 있는 aywa id)
  class_id uuid,                          -- aywa 반(오늘 수학 반의 연결 id) — 연결 안 된 반 · 없는 반이면 null
  kind text not null check (kind in ('daily', 'review', 'monthly', 'unit', 'school', 'other')),
  title text check (title is null or length(title) <= 200),
  unit_name text check (unit_name is null or length(unit_name) <= 200),
  test_date date not null,
  question_count integer not null check (question_count between 0 and 1000),
  absent boolean not null,
  score numeric check (score is null or score between 0 and 10000),
  correct_count integer check (correct_count is null or correct_count >= 0),
  taken_at timestamptz not null,
  synced_at timestamptz not null default now(),
  primary key (tenant_id, source_test_id, student_id),
  foreign key (tenant_id, student_id) references public.students(tenant_id, id) on delete cascade,
  check (not absent or (score is null and correct_count is null))
);
create index if not exists todays_math_test_results_student on public.todays_math_test_results (tenant_id, student_id, test_date desc);
create index if not exists todays_math_test_results_day on public.todays_math_test_results (tenant_id, test_date, class_id);
alter table public.todays_math_test_results enable row level security;
revoke all on public.todays_math_test_results from public, anon, authenticated;
grant all on public.todays_math_test_results to service_role;
comment on table public.todays_math_test_results is
  '오늘 수학 채점 결과(시험 × 학생의 마지막 채점). 오늘 수학에서 끌어와 날짜 단위로 갈아끼운다. 결시는 점수 없음. 서버 전용.';

-- 날짜별 마지막으로 반영한 지문 — 지문이 같으면 그날은 다시 받지 않는다.
create table if not exists public.todays_math_result_days (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  test_date date not null,
  digest text not null check (digest ~ '^[0-9a-f]{64}$'),
  row_count integer not null check (row_count >= 0),
  synced_at timestamptz not null default now(),
  primary key (tenant_id, test_date)
);
alter table public.todays_math_result_days enable row level security;
revoke all on public.todays_math_result_days from public, anon, authenticated;
grant all on public.todays_math_result_days to service_role;
comment on table public.todays_math_result_days is '오늘 수학 채점 결과의 날짜별 반영 지문. 서버 전용.';

-- 그날 행을 한 거래로 갈아끼운다. aywa에 없는 학생(지점이 다르거나 지워짐)의 행은 건너뛴다(통째 실패 금지).
-- 반은 이 지점의 반일 때만 남긴다. 같은 날을 두 작업이 동시에 갈아끼우지 않게 (지점, 날짜) 잠금.
-- 돌려주는 값 = 남은 행 수.
create or replace function public.todays_math_apply_result_day(p_tenant uuid, p_date date, p_digest text, p_rows jsonb)
returns integer language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_count integer;
begin
  if p_tenant is null or p_date is null or p_digest is null or p_digest !~ '^[0-9a-f]{64}$'
    or p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then
    raise exception '오늘 수학 결과 반영 값이 올바르지 않습니다.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('todays_math_results:' || p_tenant::text || ':' || p_date::text, 0));

  create temp table if not exists tm_incoming (
    source_test_id uuid, student_id uuid, class_id uuid, kind text, title text, unit_name text, test_date date,
    question_count integer, absent boolean, score numeric, correct_count integer, taken_at timestamptz
  ) on commit drop;
  truncate tm_incoming;
  insert into tm_incoming
  select r."sourceTestId", r."sourceStudentId", r."sourceClassId", r.kind, r.title, r."unitName", r."testDate",
         r."questionCount", r.absent, r.score, r."correctCount", r."takenAt"
  from jsonb_to_recordset(p_rows) as r(
    "sourceTestId" uuid, "sourceStudentId" uuid, "sourceClassId" uuid, kind text, title text, "unitName" text, "testDate" date,
    "questionCount" integer, absent boolean, score numeric, "correctCount" integer, "takenAt" timestamptz
  );
  if exists (select 1 from tm_incoming where test_date is distinct from p_date) then
    raise exception '오늘 수학 결과의 날짜가 맞지 않습니다.';
  end if;
  -- 결시에 점수를 실어 보내면 지운다(표 CHECK로 거래가 통째 실패하지 않게).
  update tm_incoming set score = null, correct_count = null where absent;
  delete from tm_incoming i where not exists (select 1 from public.students s where s.tenant_id = p_tenant and s.id = i.student_id);
  update tm_incoming i set class_id = null
    where class_id is not null and not exists (select 1 from public.classes c where c.tenant_id = p_tenant and c.id = i.class_id);

  delete from public.todays_math_test_results t
  where t.tenant_id = p_tenant and t.test_date = p_date
    and not exists (select 1 from tm_incoming i where i.source_test_id = t.source_test_id and i.student_id = t.student_id);

  insert into public.todays_math_test_results as t (
    tenant_id, source_test_id, student_id, class_id, kind, title, unit_name, test_date, question_count, absent, score, correct_count, taken_at, synced_at
  )
  select p_tenant, i.source_test_id, i.student_id, i.class_id, i.kind, i.title, i.unit_name, i.test_date, i.question_count, i.absent,
         i.score, i.correct_count, i.taken_at, now()
  from tm_incoming i
  on conflict (tenant_id, source_test_id, student_id) do update set
    class_id = excluded.class_id, kind = excluded.kind, title = excluded.title, unit_name = excluded.unit_name,
    test_date = excluded.test_date, question_count = excluded.question_count, absent = excluded.absent, score = excluded.score,
    correct_count = excluded.correct_count, taken_at = excluded.taken_at, synced_at = excluded.synced_at
  where (t.class_id, t.kind, t.title, t.unit_name, t.test_date, t.question_count, t.absent, t.score, t.correct_count, t.taken_at)
    is distinct from
    (excluded.class_id, excluded.kind, excluded.title, excluded.unit_name, excluded.test_date, excluded.question_count, excluded.absent,
     excluded.score, excluded.correct_count, excluded.taken_at);

  select count(*) into v_count from public.todays_math_test_results where tenant_id = p_tenant and test_date = p_date;
  insert into public.todays_math_result_days (tenant_id, test_date, digest, row_count, synced_at)
  values (p_tenant, p_date, p_digest, v_count, now())
  on conflict (tenant_id, test_date) do update set digest = excluded.digest, row_count = excluded.row_count, synced_at = excluded.synced_at;
  return v_count;
end $$;
revoke all on function public.todays_math_apply_result_day(uuid, date, text, jsonb) from public, anon, authenticated;
grant execute on function public.todays_math_apply_result_day(uuid, date, text, jsonb) to service_role;

commit;
notify pgrst, 'reload schema';
