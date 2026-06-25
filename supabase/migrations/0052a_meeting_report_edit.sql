-- 회의 AI 보고서 섹션별 인라인 수정 — 마지막 수정자(이름)·시각. staff가 인쇄/공유 전 AI 오류를 교정.
-- 섹션 본문은 기존 ai_report jsonb를 그대로 머지 수정. 여기엔 누가·언제 마지막으로 손봤는지만 기록.
alter table meeting_minutes add column if not exists ai_report_edited_by text;
alter table meeting_minutes add column if not exists ai_report_edited_at timestamptz;
