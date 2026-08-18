-- 0217a: users.report_display_name — 수업보고서 발송용 이름 (원장 2026-08-18)
--
-- 목적: 강사가 내 정보(/me)에서 "수업보고서용 이름"을 직접 정하면, 학부모에게 나가는 수업보고서
--   (ClassNote 게시 작성자명 + /r 공유 카드 '담임' 칸 + 인쇄본)가 실명 대신 그 이름으로 표시된다.
--   예: 영어 강사 영어이름, "OO쌤" 등. 비우면(NULL) 지금처럼 실명(display_name) 그대로.
--
-- ⚠️ lesson_reports.teacher_name(저장·귀속 축)은 바꾸지 않는다 — 그 컬럼은 "지난 보고서" 이력 조회
--   (`eq(teacher_name, displayName)`)·보강 소유 판정·작성률 통계가 이름 일치로 묶는 축이라, 저장값을
--   갈아끼우면 본인 이력이 통째로 사라진다. 이 컬럼은 **표시 시점**(발송 워커·/r·인쇄)에만 매핑된다.
--   매핑 규칙(표시 이름이 겹치는 직원은 매핑 제외)은 src/features/onescreen/report-author-name.ts 단일 소스.
--
-- 앱은 이 컬럼 없이도 동작한다(조회 fail-soft + 저장은 42703을 한글 안내로 — gotcha #95 expand/contract)
--   — 적용 순서 제약 없음: SQL을 나중에 적용하면 그때부터 입력·매핑이 살아날 뿐 아무것도 죽지 않는다.
alter table public.users
  add column if not exists report_display_name text;

comment on column public.users.report_display_name is
  '수업보고서 발송용 표시 이름(본인이 /me에서 입력) — NULL=실명(display_name) 그대로. 발송·공유·인쇄 표시에만 쓰고 lesson_reports.teacher_name 저장 축은 불변 (0217a)';
