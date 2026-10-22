-- 0395a 시간표 칸 메모 — 영어 강사뷰에서 칸마다 우클릭으로 다는 메모(원장 2026-10-22 *"각 셀마다 우클릭해서 엑셀처럼 메모 입력할 수 있게.
-- 실시간 저장되게 해주고 마지막 수정자 누군지"* · 메모 단위 = "그 날짜 칸에만").
-- 메모 하나 = 지점 × 과목 × 날짜 × 강사 열쇠 × 칸 시작 시각(분). 강사 열쇠는 이름 글자가 아니라 `u:<users.id>` · `s:LAB|JJ`(자리) ·
-- `l:<라벨>`(직원으로 풀리지 않는 열) — 이름 표기를 바꿔도 메모가 고아가 되지 않게(`src/features/timetable-cell-memo/teacher-key.ts`).
-- 🔴 정책 0개 = 의도: 읽기·쓰기는 서버(관리 키)만 한다(0374a `timetable_memo_sheets`와 같은 규약 → 모든 조회·쓰기에 tenant_id 명시).
--    화면 게이트 = 시간표 열람(보기) · 시간표 '전체'(편집) · 강사 화면에는 안 보인다(`timetable-memo/server/access.ts` memoSheetAccess).
-- 🔴 동시 저장은 version 비교로 막는다(같은 version일 때만 갈아끼움). 상자 크기(box_w·box_h)만 바꾼 것은 내용 수정이 아니라
--    version·수정 시각·수정자를 바꾸지 않는다(구글 시트도 크기 조절은 내용 수정이 아니다).
-- 🔴 유니크는 **일반 유니크**(부분 유니크 WHERE 금지 — upsert 추론이 깨진다, gotchas #113).
-- 이전 내용은 감사로그(timetable_cell_memo_update·_delete의 metadata.before)에 남는다 — 이 표엔 마지막 것만.
-- 앱 배포와 순서 무관: 표가 없으면 강사뷰는 메모 없이 그대로 열린다(우클릭 메뉴도 안 뜬다).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table if not exists public.timetable_cell_memos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  subject text not null check (char_length(subject) between 1 and 40),
  memo_date date not null,
  teacher_key text not null check (char_length(teacher_key) between 3 and 140),
  teacher_label text not null check (char_length(teacher_label) between 1 and 100),
  start_min integer not null check (start_min between 0 and 1439),
  body text not null check (char_length(body) between 1 and 2000 and char_length(btrim(body, E' \t\r\n')) > 0),
  box_w integer check (box_w between 160 and 640),
  box_h integer check (box_h between 80 and 480),
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  created_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null,
  constraint timetable_cell_memos_cell_key unique (tenant_id, subject, memo_date, teacher_key, start_min)
);
-- 조회는 언제나 (지점 · 과목 · 그 주 7일) — 위 유니크 인덱스의 앞 세 칸이 그대로 받는다.
create index if not exists timetable_cell_memos_created_by_idx on public.timetable_cell_memos (created_by);
create index if not exists timetable_cell_memos_updated_by_idx on public.timetable_cell_memos (updated_by);

alter table public.timetable_cell_memos enable row level security;
revoke all on public.timetable_cell_memos from public, anon, authenticated;
grant all on public.timetable_cell_memos to service_role;

comment on table public.timetable_cell_memos is
  'Per-cell notes on the timetable teacher view (tenant × subject × date × teacher key × start minute). Server-only (no policies by design); writes compare version.';
commit;
