-- 0370a — **자동작성 원문** 보관(보고서 한 건당 한 줄) — 선생님이 고쳐 보낸 멘트의 AI 원문 (원장 2026-10-16)
--
-- 원장 *"선생님이 작성한 (수정하거나 직접쓴 멘트들)은 학습하고 Ai가 점점 나은 멘트로 가고 있나? 선생님 멘트를 닮아가는등"* →
-- *"한계를 수정할 수 있을까"*. 0214a `lesson_reports.ment_source`는 "자동작성 후 수정"이라는 **사실만** 남겨, 선생님이
-- **무엇을** 고쳤는지(늘 지우는 말·바꾸는 말·덧붙이는 말)는 배울 수 없었다. 이 표가 그 원문을 남기고, 주 1회 말투 프로파일
-- 빌드(0262a `teacher_ment_styles`)가 원문 ↔ 선생님 최종(`lesson_reports.notes`)을 견줘 '늘 고치는 것'을 지침에 싣는다.
--
-- 쓰는 곳 = 원스크린 저장(saveLessonReport)이 **응답 뒤에**(`after`) 한 줄 upsert — 최종 작성 방식이 'auto_edited'일 때만.
-- 읽는 곳 = 말투 프로파일 빌드(server/ment-style-build.ts) — 자동작성 후 수정 표본의 원문만.
--
-- 🔴 읽기·쓰기 정책을 두지 않는다 — 서버(service_role)만 읽고 쓴다(0262a와 같은 규약: admin 클라이언트 + tenant_id 명시 필터).
--    정책이 0개인 것은 **의도적**이다([[#92]] "의도적 제외는 마이그레이션에 적는다"). 브라우저 역할로는 0행([[#104]]).
-- ⚠️ 앱은 이 표가 **없어도 돌아간다**([[#95]]) — 기록·조회 모두 표 부재를 조용히 건너뛴다(보고서 저장과 무관). 적용 순서 제약 없음:
--    적용한 그 시점부터 원문이 쌓인다(소급 없음 — 지난 수정본의 원문은 어디에도 남아 있지 않다).
-- 보고서가 지워지면 원문도 함께 지워진다(on delete cascade).
--
-- 롤백: drop table if exists public.ment_ai_drafts;
set local statement_timeout = '60s';

create table if not exists public.ment_ai_drafts (
  report_id uuid primary key references public.lesson_reports(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- 보고서의 소유 강사(lesson_reports.created_by와 같은 값) — 프로파일 빌드가 강사별로 읽는다.
  teacher_id uuid references public.users(id) on delete set null,
  ai_draft text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.ment_ai_drafts is
  '자동작성 원문(보고서당 1행) — 선생님이 고쳐 보낸 멘트의 AI 원문. 말투 프로파일(0262a)이 원문↔최종을 견줘 "늘 고치는 것"을 배운다. 서버 전용(정책 0개 = 의도). 0370a';

create index if not exists ment_ai_drafts_tenant_teacher_idx
  on public.ment_ai_drafts (tenant_id, teacher_id, created_at desc);

alter table public.ment_ai_drafts enable row level security;

notify pgrst, 'reload schema';
