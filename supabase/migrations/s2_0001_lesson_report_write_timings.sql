-- s2_0001: 수업보고서 작성 시간 기록(원장 2026-10-28 *"선생님별 평균 작성시간 · 카드형인지 표형식인지 · 어떤 영역 작성시간이 제일 긴지"*
--          → *"응 기록 추가해줘"*).
--
-- 원스크린에서 보고서를 저장·발송할 때마다 한 줄: 누가 · 어느 화면(카드/표)에서 · 한 건씩/일괄로 · 첫 손댄 때부터 걸린 시간 ·
-- 손으로 쓴 시간 · 영역별(진도·테스트·태도·숙제·이해도·한마디·본문 수정·자동작성 대기…) 손댄 횟수와 시간.
-- 규칙은 src/features/onescreen/write-timing.ts. 같은 보고서를 다시 고쳐 보내면 줄이 하나 더 생긴다(그 사이 것만).
--
-- 🔴 서버 전용 표(정책 0개 = 의도 — 0370a ment_ai_drafts와 같은 규약). 앱은 admin으로 쓰고 tenant_id를 직접 건다.
--    읽는 화면은 아직 없다(조회는 운영자 스크립트). 화면을 만들 때 정책을 따로 정한다.
-- 앱은 이 표가 없어도 돈다(기록만 건너뛴다) — 적용 순서 상관없음.

create table if not exists public.lesson_report_write_timings (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  report_id uuid not null references public.lesson_reports(id) on delete cascade,
  teacher_id uuid references public.users(id) on delete set null,  -- 저장·발송을 누른 사람
  report_date date,
  subject text,
  send_view text not null check (send_view in ('card', 'grid')),   -- 저장·발송을 누른 화면
  send_mode text not null check (send_mode in ('single', 'bulk')), -- 한 건씩 / 일괄 저장·발송
  queued boolean not null default false,                            -- 발송(ClassNote 큐)까지 / 저장만
  started_at timestamptz,                                           -- 이 보고서 칸을 처음 손댄 때(새로고침 뒤면 그 뒤부터)
  total_ms integer,                                                 -- 처음 손댄 때 → 저장·발송
  active_ms integer not null default 0,                             -- 손으로 쓴 시간 합(자리 비운 90초 넘는 틈·자동작성 대기 제외)
  edits_card integer not null default 0,                            -- 카드에서 손댄 횟수
  edits_grid integer not null default 0,                            -- 표에서 손댄 횟수
  fields jsonb not null default '{}'::jsonb,                        -- { 영역: { edits, ms, bulk, prev, firstSec, lastSec } }
  created_at timestamptz not null default now()
);

comment on table public.lesson_report_write_timings is
  '수업보고서 작성 시간 기록 — 원스크린 저장·발송 한 번당 한 줄(화면·방식·영역별 손댄 횟수·시간). 서버 전용(정책 0개 = 의도). s2_0001';

create index if not exists lesson_report_write_timings_tenant_created_idx
  on public.lesson_report_write_timings (tenant_id, created_at desc);
create index if not exists lesson_report_write_timings_tenant_teacher_idx
  on public.lesson_report_write_timings (tenant_id, teacher_id, report_date);
create index if not exists lesson_report_write_timings_report_idx
  on public.lesson_report_write_timings (report_id);

alter table public.lesson_report_write_timings enable row level security;
revoke all on table public.lesson_report_write_timings from anon, authenticated;

notify pgrst, 'reload schema';
