-- 등록상담 AI 분석 섹션 인라인 수정 — 마지막 수정자(이름)·시각. staff가 인쇄/공유 전 AI 오류를 교정.
-- 섹션 본문은 print_payload.audioReport jsonb를 머지 수정(동결 스냅샷이지만 명시적 교정은 허용).
-- ⚠️ 명시적 "재분석"을 누르면 같은 model_version 행이 덮어써질 수 있음(재분석은 명시 버튼 — 사용자 인지).
alter table consultation_ai_analysis add column if not exists report_edited_by text;
alter table consultation_ai_analysis add column if not exists report_edited_at timestamptz;
