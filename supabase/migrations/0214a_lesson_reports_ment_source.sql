-- 0214a: lesson_reports.ment_source — 멘트(학부모 보고서 본문 notes) 작성 방식 구분 (원장 2026-08-18)
--
-- 목적: 강사별 "직접 쓴 멘트" 코퍼스 축적 → 후속으로 강사별 자동생성 멘트에 그 강사 말투를 반영.
--   코퍼스 추출 시 결합 키: created_by(원 작성자, 0172a) + ment_source='manual'(필요 시 auto_edited 포함).
-- 값: 'auto'(자동작성 그대로 — AI 성공분·실패 시 템플릿 폴백 포함) | 'auto_edited'(자동작성 후 강사가 수정)
--     | 'manual'(처음부터 직접 작성) | NULL(도입 전 저장분·판정 불가 — 소급하지 않는다, 모르면 null이 정직).
-- plain text(체크제약 없음) — classnote_status 선례: 새 값 추가에 마이그레이션 불필요.
--   판정 규칙·라벨은 src/features/onescreen/ment-source.ts 단일 소스.
-- 앱은 이 컬럼 없이도 동작한다(mentSourceColumnReady probe 기반 조건 배선, gotcha #95 expand/contract)
--   — 적용 순서 제약 없음: SQL을 나중에 적용하면 그 시점부터 기록이 시작될 뿐 아무것도 죽지 않는다.
alter table public.lesson_reports
  add column if not exists ment_source text;

comment on column public.lesson_reports.ment_source is
  '멘트(notes) 작성 방식: auto=자동작성 그대로 / auto_edited=자동작성 후 수정 / manual=직접 작성 / NULL=도입 전·미상 (0214a)';
