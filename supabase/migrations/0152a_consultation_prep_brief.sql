-- 0152a_consultation_prep_brief.sql (손수 alpha)
-- 등록상담 **사전 브리프(상담지)** — 상담을 시작하기 전에 상담자가 받아보는 준비 문서.
--
-- 배경: eywa엔 상담 *후* 산출물(consultation_ai_analysis = 인수인계서)만 있었다. 정작 상담사가
-- 아쉬운 순간은 상담 직전 — 학부모가 QR 접수 폼에 답한 13문항과 학원의 실데이터(개설 반·잔여석·
-- 시간·강사·수강료·같은 학교 재원생·형제 재원 여부)를 머릿속에서 조합해야 했다.
--
-- ⚠️ 별도 테이블이 아니라 상담 행의 컬럼인 이유: 브리프는 **상담 1건에 1개**(재생성=덮어쓰기)이고
--    상담이 지워지면 같이 지워져야 한다. 이력 보존이 필요한 산출물(분석 리포트)과 성격이 다르다.
-- ⚠️ 저장 형태는 스냅샷이다 — facts(그때의 반·잔여석·단가)까지 함께 굳힌다. 나중에 반이 폐강돼도
--    "그때 이 자료로 상담했다"가 재현돼야 하기 때문(print_payload 동결과 같은 정책).

alter table enrollment_consultations
  add column if not exists prep_brief jsonb;
alter table enrollment_consultations
  add column if not exists prep_brief_at timestamptz;

comment on column enrollment_consultations.prep_brief is
  '사전 상담 브리프 스냅샷 { version, source(ai|fallback), model, generatedAt, facts, brief }. 0152a';
comment on column enrollment_consultations.prep_brief_at is
  '사전 브리프 생성 시각(NULL=미생성). 목록에서 "브리프 있음" 판정에 쓴다. 0152a';

-- 신규 컬럼은 supabase-js(PostgREST)로 select/update되므로 스키마 캐시 리로드 필수(0061a·0062a 규약).
notify pgrst, 'reload schema';
