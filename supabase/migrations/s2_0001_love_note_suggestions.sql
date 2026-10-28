-- s2_0001 — 사랑의 한마디 **AI 초안** 보관(학생 × 보고서 날짜 × 과목 한 줄 · 마지막 초안) — 원장 2026-10-28
--
-- 원장 *"사랑의 한마디도 선생님이 그러면 자주 적고 하는 걸로 학습하고 수정은 어떻게 하는지도 그에 맞게 초안 작성 버튼 따로 눌러서
-- 넣어지게"*. 원스크린 사랑의 한마디 칸의 [초안] 버튼(server/love-note-actions.ts `suggestLoveNote`)이 만든 글을 남긴다.
-- 다음 초안을 만들 때 이 줄 ↔ 그날 실제로 보낸 보고서의 '■ 사랑의 한마디'를 견줘(같은 학생·날짜·과목) **선생님이 어떻게 고쳤는지**를
-- 예시로 싣는다(love-note.ts `pairLoveNoteEdits`). 같은 칸에서 초안을 여러 번 누르면 마지막 것만 남는다(유니크 + upsert).
--
-- 쓰는 곳 = suggestLoveNote(응답 뒤에 upsert). 읽는 곳 = 같은 함수(그 강사의 최근 초안 20줄).
-- 🔴 읽기·쓰기 정책을 두지 않는다 — 서버(service_role)만 읽고 쓴다(0370a `ment_ai_drafts`와 같은 규약: admin 클라이언트 + tenant_id
--    명시 필터). 정책이 0개인 것은 **의도적**이다([[#92]] "의도적 제외는 마이그레이션에 적는다"). 브라우저 역할로는 0행([[#104]]).
-- 🔴 유니크에 WHERE를 붙이지 않는다([[#113]] — upsert가 추론하지 못한다).
-- ⚠️ 앱은 이 표가 **없어도 돌아간다**([[#95]]) — 초안은 만들어지고, 기록·고친 예시만 조용히 건너뛴다. 적용 순서 제약 없음.
-- 학생·지점이 지워지면 함께 지운다 · 강사 계정이 지워지면 teacher_id만 비운다.
--
-- 롤백: drop table if exists public.love_note_suggestions;
set local statement_timeout = '60s';

create table if not exists public.love_note_suggestions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- 초안을 누른 화면의 강사 스코프(effectiveTeacherId) — 관리자 뷰 대리 작성은 비어 있을 수 있다.
  teacher_id uuid references public.users(id) on delete set null,
  student_id uuid not null references public.students(id) on delete cascade,
  report_date date not null,
  subject text not null,
  ai_note text not null constraint love_note_suggestions_ai_note_len check (char_length(ai_note) between 1 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint love_note_suggestions_cell_key unique (tenant_id, student_id, report_date, subject)
);

comment on table public.love_note_suggestions is
  '사랑의 한마디 AI 초안(학생×날짜×과목 1행, 마지막 초안) — 다음 초안이 선생님이 고친 방식을 배운다. 서버 전용(정책 0개 = 의도). s2_0001';

create index if not exists love_note_suggestions_tenant_teacher_idx
  on public.love_note_suggestions (tenant_id, teacher_id, created_at desc);

alter table public.love_note_suggestions enable row level security;

drop trigger if exists love_note_suggestions_set_updated_at on public.love_note_suggestions;
create trigger love_note_suggestions_set_updated_at before update on public.love_note_suggestions
  for each row execute function public.tg_set_updated_at();

notify pgrst, 'reload schema';
