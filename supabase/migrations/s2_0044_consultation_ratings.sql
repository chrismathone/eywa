-- 원생상담 평점(참고용) — 원장 2026-11-11 *"후속 열 하고 녹음/AI 열 제거 → 상담 평점 열 추가. 모든 상담을 ai가 분석해서
-- (상담 업로드하자마자 분석할 필요없고 배치돌려서 분석하기, 보고서 평점처럼) · 보고서와 같은 잣대"* ·
-- *"지금 업로드된 상담들은 전부 내부 요금제로 돌리고 평점 고도화시키고 · 이후에는 배치로"*.
--
-- 🔑 두 표: 평점 값(student_consultation_ratings) + 정기 처리 대기열(student_consultation_rating_queue). 수업보고서의
--    0450a(lesson_report_ratings) · 0455a(lesson_report_rating_queue)와 같은 모양이다.
-- 🔑 기능은 기본 꺼짐: 운영 콘솔 지점 스위치 'consult_rating'(tenant_licenses, 행 없음 = 꺼짐)을 켠 지점만 cron이 줄을 만들고
--    목록에 '상담 평점' 열이 선다. 이 SQL을 적용해도 스위치를 켜기 전엔 아무것도 돌지 않는다.
-- 🔑 source: 'cli' = 내부 요금제(구독 CLI) 일괄 평점(지금 올라와 있는 상담) · 'batch' = 정기 처리(Anthropic Message Batches).
--    같은 기준·같은 프롬프트라 값은 같은 눈금이지만, 어느 쪽이 매겼는지 남겨 두 방식의 차이를 따로 볼 수 있게 한다.
-- 🔴 RLS 정책 0개 = 의도적([[#92]] "의도적 제외는 마이그레이션에 적어라"): 상담자의 기록을 평가한 값이라 PostgREST 직결로 열지 않는다.
--    앱은 상담 쓰기 권한(canWriteTenant 'consultations')을 서버에서 다시 본 뒤 admin + tenant_id 필터로 읽는다([[#104]] —
--    정책 0개 표를 세션 클라이언트로 읽으면 에러 없이 0행).
-- ⚠️ 앱은 이 SQL 적용 전에도 죽지 않는다([[#95]]): 표가 없으면 목록은 평점 열 없이 그대로 뜨고, 정기 처리는 '준비 안 됨'으로 멈춘다.
-- 되돌리기 = scripts/_oneoff/revert-s2_0044-consultation-ratings.sql (본문에 붙이지 않는다).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table if not exists public.student_consultation_ratings (
  consultation_id uuid primary key references public.student_consultations (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  -- 1~5 정수(수업보고서 평점 v6과 같은 눈금). 평점 없음('—')은 행을 두지 않는다.
  points smallint not null check (points between 1 and 5),
  -- 근거 — 한 줄 이유 + 기록 인용. 화면은 마우스 오버 카드에만 쓴다.
  reason text not null default '',
  evidence text not null default '',
  -- 상담 사유 태그(점수 아님 · 기록에서 읽은 사유의 분류 코드 배열 — 앱이 한글로 바꿔 보여 준다)와 네 칸 상태
  -- (reason · context · response · next = present / not_recorded / not_applicable / unclear, unsure = 경계가 불분명했나).
  -- 🔴 not_recorded는 '기록에 없다'는 뜻이지 '실제로 없었다'는 뜻이 아니다.
  kinds jsonb check (kinds is null or jsonb_typeof(kinds) = 'array'),
  checks jsonb check (checks is null or jsonb_typeof(checks) = 'object'),
  -- 코드 규칙이 점수를 정했거나 눌렀으면 그 규칙('empty' = 빈 양식 1점 · 'copied' = 같은 글 여러 학생 3점까지) — 모델이 매긴 값 그대로가 아니라는 표시.
  rule text check (rule is null or rule in ('empty', 'copied')),
  -- 평가한 자료 — memo = 상담자가 쓴 기록 · recording = 직접 쓴 기록 없이 녹음 전사문(눈금이 수기 기록과 다를 수 있다).
  basis text not null default 'memo' check (basis in ('memo', 'recording')),
  rubric text not null,
  model text not null,
  source text not null default 'batch' check (source in ('cli', 'batch')),
  -- 평점을 매긴 입력의 지문(기준 판 + 그 상담 자신의 칸). 상담을 고치면 달라져 다시 줄을 선다.
  input_hash text not null,
  -- 재료를 읽던 때 그 상담의 updated_at — '그 뒤에 고쳐졌나'를 **같은 DB 값끼리** 견주려고 적는다(앱 서버 시계와 DB 시계를 견주지 않는다 ·
  -- 재료를 읽은 뒤·저장하기 전에 일어난 수정도 놓치지 않는다). 비어 있으면 확인 못 한 것이라 다시 확인할 후보가 된다.
  source_updated_at timestamptz,
  rated_on date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists student_consultation_ratings_tenant_idx on public.student_consultation_ratings (tenant_id, rubric);

alter table public.student_consultation_ratings enable row level security;
-- 정책 0개(의도적, 위 머리 주석) — anon·authenticated엔 권한 자체를 주지 않는다.
revoke all on public.student_consultation_ratings from public, anon, authenticated;
grant select, insert, update, delete on public.student_consultation_ratings to service_role;

create table if not exists public.student_consultation_rating_queue (
  consultation_id uuid primary key references public.student_consultations (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  stage text not null default 'queued' check (stage in ('queued', 'submitting', 'submitted', 'done', 'failed')),
  input_hash text,
  -- 이 줄이 마지막으로 다룬 상담의 updated_at · 다룬 기준 판 — 닫힌(failed) 줄은 상담이 다시 고쳐지거나 기준 판이 오르기 전엔 다시 세우지 않는다.
  source_updated_at timestamptz,
  rubric text,
  batch_id text,
  custom_id text,
  attempts integer not null default 0 check (attempts >= 0),
  lock_token uuid,
  locked_at timestamptz,
  error text,
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists student_consultation_rating_queue_stage_idx on public.student_consultation_rating_queue (tenant_id, stage, updated_at);
create index if not exists student_consultation_rating_queue_batch_idx on public.student_consultation_rating_queue (tenant_id, batch_id) where batch_id is not null;

alter table public.student_consultation_rating_queue enable row level security;
revoke all on public.student_consultation_rating_queue from public, anon, authenticated;
grant select, insert, update, delete on public.student_consultation_rating_queue to service_role;

-- 첫 판(2026-11-11 · 이 세 칸이 없던 판)을 먼저 적용한 DB도 같은 모양이 되게 — 멱등(표를 지우고 다시 만들지 않는다).
alter table public.student_consultation_ratings add column if not exists source_updated_at timestamptz;
alter table public.student_consultation_rating_queue add column if not exists source_updated_at timestamptz;
alter table public.student_consultation_rating_queue add column if not exists rubric text;

comment on table public.student_consultation_ratings is
  '원생상담 평점(참고용 · 2026-11-11). 기록의 정성·구체성을 1~5로 매긴 값 — 앱은 AI를 부르지 않고 저장값만 보여 준다. 정책 0개(의도적) — 상담 쓰기 권한자만 앱(admin + tenant_id)으로 읽는다.';
comment on table public.student_consultation_rating_queue is
  '원생상담 평점 정기 처리 대기열(2026-11-11). 지점 스위치 consult_rating을 켠 지점만 줄이 생긴다. 정책 0개(의도적) — 서버 admin + tenant_id로만.';
comment on column public.student_consultation_ratings.source is
  'cli = 내부 요금제(구독 CLI) 일괄 평점 · batch = 정기 처리(Message Batches). 같은 기준·같은 프롬프트.';
comment on column public.student_consultation_ratings.rule is
  '코드 규칙이 점수를 정했거나 눌렀을 때의 규칙 코드. 비어 있으면 모델이 매긴 값 그대로.';

commit;

notify pgrst, 'reload schema';
