-- 0153b_prep_brief_status.sql (손수 alpha)
-- 사전 브리프 생성 **백그라운드화** — 진행 상태 컬럼.
--
-- 배경: 0152a의 generatePrepBrief가 사실 수집→LLM→저장을 전부 동기로 기다려 버튼이 20~40초
-- "작성 중…"에 잡혔다(병목 = LLM 한국어 JSON 생성 시간). 회의록 "AI 분석 다시 생성"과 동일하게
-- 액션은 즉시 반환하고 after() 백그라운드로 옮긴다 — 이 컬럼이 진행 UI(진행바·자동 새로고침)의 근거다.
--
-- ⚠️ 기존 prep_brief(완성 스냅샷)는 생성 중에도 **유지**된다 — 재생성이 실패해도 직전 브리프가
--    남아야 한다(먼저 지우면 실패 = 브리프 증발).
--
-- 값: NULL=대기/완료 · 'generating'=백그라운드 생성 중 · 'failed'=실패(에러는 prep_brief_error).

alter table enrollment_consultations
  add column if not exists prep_brief_status text;
alter table enrollment_consultations
  add column if not exists prep_brief_error text;

comment on column enrollment_consultations.prep_brief_status is
  '사전 브리프 생성 상태(NULL=대기/완료, generating, failed). 진행 UI·watcher 근거. 0153b';
comment on column enrollment_consultations.prep_brief_error is
  '사전 브리프 생성 실패 사유(한글 요약 — raw 원문 금지). status=failed일 때만 의미. 0153b';

-- 신규 컬럼은 supabase-js(PostgREST)로 select/update되므로 스키마 캐시 리로드 필수(0061a·0062a 규약).
notify pgrst, 'reload schema';
