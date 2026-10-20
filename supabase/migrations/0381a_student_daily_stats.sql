-- 0381a — 원생 매일 기록(원장 2026-10-20 *"과거를 확인할 수 없는것은 억지로 확인할 필요없고, 확보가능한 데이터 및 앞으로의 추세를
-- 정확하게 파악할 수 있게하는것이 목표"* → *"오늘부터 기록 시작"*).
--
-- 학년·학교·휴원은 **지금 값만** 저장돼 있어(진급 기록 없음 · makeedu도 지금 값만 — 2026-10-20 조사) 지난 시점의 학년별·학교별·휴원
-- 인원을 되살릴 수 없다. 그래서 오늘부터 하루 한 줄씩 그날의 구성을 남긴다 — 쌓인 날부터 원생 통계가 정확한 흐름을 그린다.
--   student_daily_stats  지점 × 날짜 한 줄 · `data` = 그날 23:55(KST) 재원생 구성(운영실 '재원생' 카드와 같은 계산 함수의 결과)
--                        { v, enrolled, onHold, levels{}, grades{}, gradeMix[], schools{}, subjects{}, programs{} } — 인원 수만(이름·연락처 없음).
-- 쓰는 곳 = cron `/api/cron/student-daily-stats`(관리 키) 하나. 같은 날 다시 돌면 덮어쓴다(그날의 마지막 상태).
--
-- 🔴 서버 전용(정책 0개 · 0374a·0376a·0377a와 같은 방식): 앱이 권한(원생 메뉴)을 확인한 뒤 관리 키 + tenant_id로 읽는다.
--    사람이 화면에서 쓰는 길은 없다.
-- 배포 순서: 앱보다 먼저(#95) — cron이 이 표에 쓴다(표가 없으면 그날 기록이 실패로 남을 뿐 화면은 안 죽는다).
-- 되돌리기: drop table public.student_daily_stats;

create table if not exists public.student_daily_stats (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  stat_date date not null,
  data jsonb not null,
  recorded_at timestamptz not null default now(),
  primary key (tenant_id, stat_date)
);

comment on table public.student_daily_stats is
  '원생 매일 기록 — 지점×날짜 한 줄, 그날 재원생 구성(인원 수만). cron /api/cron/student-daily-stats가 쓴다. 0381a.';

alter table public.student_daily_stats enable row level security;
revoke all on public.student_daily_stats from public, anon, authenticated;
grant all on public.student_daily_stats to service_role;
