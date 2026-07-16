-- 0116a: 일일 브리핑 v2 — "학원 매니저 팀" 보고 컬럼 (2026-07-16 원장 방향: eywa = 학원 매니저 팀).
-- team_report jsonb = 검증(validateTeamReport) 통과한 LLM 팀 보고 { headline, managers:[{area, report}] }.
-- 기존 narrative(text, 단문 서술)는 하위호환 표시용으로 남긴다(새 행은 team_report만 기록).
-- payload는 계속 결정론 전용(스포트라이트 명단 포함) — 카드가 payload를 직접 렌더하고 LLM 보고는 보조.
-- ⚠️ drizzle journal 밖(손수 alpha). 신규 DB는 pnpm db:alphas가 사전순 적용.

alter table daily_briefings add column if not exists team_report jsonb;

comment on column daily_briefings.team_report is
  '매니저 팀 보고(LLM, 가드 통과분만): {headline, managers:[{area: 수업|학생|상담|수납|운영, report}]}';
