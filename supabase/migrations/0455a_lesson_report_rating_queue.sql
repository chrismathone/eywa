-- 수업보고서 평점 정기 처리(2026-10-26 크레딧 MVP) — 평점 대기열 표 + 평점 행의 입력 지문 칸.
--
-- 🔑 기능은 기본 꺼짐: 운영 콘솔 지점 스위치 'report_rating'(tenant_licenses, 행 없음 = 꺼짐)을 켠 지점만 cron이 줄을 만든다.
--    cron(`/api/cron/report-ratings`)은 vercel.json에 아직 등록하지 않았다 — 이 SQL을 적용해도 저절로 돌지 않는다.
-- 🔑 흐름: 발송된 새 보고서(정상 발송 · 테스트 학생 제외 · 평점 없음) → 대기열(queued) → 선점(submitting) → Batch API(submitted)
--    → 수거 때 **입력 지문이 그대로인 것만** lesson_report_ratings에 저장(done). 보고서를 고쳐 다시 보냈으면 지문이 달라 다시 줄을 선다.
--    대상은 정상 발송(success)만 — 회수·재발송 중이면 다시 나갈 때까지 기다리고(줄 선 지 14일이 지나면 닫는다), 외부 AI 전송 금지 정보가 글에 있으면 보내지 않고 failed로 닫는다.
--    평점은 Claude Haiku 5.5 단독 판정이라 claim은 'flagged'(1차 판정만)까지만 — 'confirmed'(두 검증 일치)는 붙이지 않는다.
-- 🔴 RLS 정책 0개(의도적, 0450a와 같은 까닭 — 선생님 보고서 평가 값 · 판정 원문): 서버 admin + tenant_id 필터로만 읽고 쓴다([[#92]] · [[#104]]).
-- ⚠️ 앱은 이 SQL 적용 전에도 죽지 않는다([[#95]]): 수업보고서 목록은 lesson_report_ratings의 옛 칸만 읽고,
--    정기 처리는 대기열 표가 없으면 '준비 안 됨'으로 멈춘다.
-- 되돌리기 = scripts/_oneoff/revert-0455a-lesson-report-rating-queue.sql (본문에 붙이지 않는다).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 평점을 매긴 입력의 지문(기준 판 + 그 보고서 자신의 칸 — 친구 글·직전 글은 넣지 않는다) — 옛 5,256행은 비어 있다(10-22 오프라인 배치는 지문을 남기지 않았다).
alter table public.lesson_report_ratings add column if not exists input_hash text;

create table if not exists public.lesson_report_rating_queue (
  report_id uuid primary key references public.lesson_reports (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  stage text not null default 'queued' check (stage in ('queued', 'submitting', 'submitted', 'done', 'failed')),
  input_hash text,
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
create index if not exists lesson_report_rating_queue_stage_idx on public.lesson_report_rating_queue (tenant_id, stage, updated_at);
create index if not exists lesson_report_rating_queue_batch_idx on public.lesson_report_rating_queue (tenant_id, batch_id) where batch_id is not null;

alter table public.lesson_report_rating_queue enable row level security;
-- 정책 0개(의도적, 위 머리 주석) — anon·authenticated엔 권한 자체를 주지 않는다.
revoke all on public.lesson_report_rating_queue from public, anon, authenticated;
grant select, insert, update, delete on public.lesson_report_rating_queue to service_role;

comment on table public.lesson_report_rating_queue is
  '수업보고서 평점 정기 처리 대기열(2026-10-26). 지점 스위치 report_rating을 켠 지점만 줄이 생긴다. 정책 0개(의도적) — 서버 admin + tenant_id로만.';
comment on column public.lesson_report_ratings.input_hash is
  '평점을 매긴 입력의 지문(기준 판 + 그 보고서 자신의 칸). 정기 처리가 수거할 때 지금 보고서와 같은지 확인한다. 10-22 오프라인 배치분은 비어 있다.';

commit;

notify pgrst, 'reload schema';
