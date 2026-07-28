-- 0148a_onescreen_test_score_mode.sql (손수 alpha)
-- 원스크린 일일/확인테스트 점수 "표기 모드"의 **세션 단위 오버라이드**.
--   NULL    = 학원 설정 기본(tenant_settings.report.dailyTestScoreMode / checkTestScoreMode)을 따름
--   'score' = 점수 모드("95점")            — 인재원 일일테스트(100점 만점)
--   'count' = 개수 모드("20문제 중 18개")   — 개념백지테스트 등(현행 기본)
--
-- 문항수(daily_max/check_max) 승계와 **동일한 패턴**으로 소비한다: 학원 기본 시드 → 세션값이 있으면 덮어쓰기.
-- 단 모드 승계는 원장 요구(토글이 다음 보고서로 이어짐)로 allowTeacherTestMax와 무관하게 항상 동작(roster.ts).
-- CHECK 제약은 repo 관행상 생략(Zod enum이 설정 저장 경로에서, roster/actions가 런타임에서 검증).

alter table onescreen_daily_sessions
  add column if not exists daily_score_mode text;
alter table onescreen_daily_sessions
  add column if not exists check_score_mode text;

comment on column onescreen_daily_sessions.daily_score_mode is
  '일일테스트 점수 표기 모드 오버라이드(score|count, NULL=학원설정 기본). 0148a';
comment on column onescreen_daily_sessions.check_score_mode is
  '확인테스트 점수 표기 모드 오버라이드(score|count, NULL=학원설정 기본). 0148a';

-- ⚠️ 신규 컬럼은 supabase-js(PostgREST)로 select(roster.ts)·upsert(actions.ts)되므로 스키마 캐시를
--    리로드해야 조회/저장에 즉시 잡힌다(0061a·0062a 규약). 형제 컬럼 0093a special_note가 notify
--    누락으로 남긴 불일치 전례가 있어 이번엔 반드시 포함.
notify pgrst, 'reload schema';
