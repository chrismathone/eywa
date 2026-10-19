-- 0374a 시간표 메모 시트 — 영어 시간표 오른쪽 엑셀 판(원장 2026-10-19 *"영어 시간표 오른쪽으로 스크롤 하면 … 그냥 엑셀창처럼"*).
-- 지점 × 과목 한 장. 내용(doc)은 서식 표를 접은 모양(`src/features/timetable-memo/pack.ts` — 같은 서식은 한 번만 적는다).
-- 🔴 정책 0개 = 의도: 읽기·쓰기는 서버(관리 키)만 한다(0370a `ment_ai_drafts`와 같은 규약 → 모든 조회·쓰기에 tenant_id 명시).
--    화면 게이트 = 시간표 열람(보기) · 시간표 '전체'(편집) · 강사 화면에는 안 보인다(`timetable-memo/server/access.ts`).
-- 🔴 동시 저장은 version 비교로 막는다(같은 version일 때만 갈아끼움 — 늦게 저장한 사람이 앞 저장을 조용히 덮지 않게).
-- 앱 배포와 순서 무관: 표가 없어도 시간표는 그대로 열린다(오른쪽 시트 판에 "불러오지 못했습니다" 안내만 — 저장도 안 됨).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table if not exists public.timetable_memo_sheets (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  subject text not null check (char_length(subject) between 1 and 40),
  doc jsonb not null check (jsonb_typeof(doc) = 'object' and octet_length(doc::text) <= 4194304),
  version integer not null default 1 check (version >= 1),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null,
  primary key (tenant_id, subject)
);
create index if not exists timetable_memo_sheets_updated_by_idx on public.timetable_memo_sheets (updated_by);

alter table public.timetable_memo_sheets enable row level security;
revoke all on public.timetable_memo_sheets from public, anon, authenticated;
grant all on public.timetable_memo_sheets to service_role;

comment on table public.timetable_memo_sheets is
  'Free-form spreadsheet beside the timetable (one per tenant × subject). Server-only (no policies by design); writes compare version.';
commit;
