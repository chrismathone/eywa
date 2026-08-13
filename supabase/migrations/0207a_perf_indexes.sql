-- 0207a — 반복 폴링 쿼리용 인덱스 3개 (2026-08-13 성능 계측)
--
-- 원장: *"eywa에서 병목현상 발생하는곳 있나? 왜 자꾸 느려지는것 같지."*
--
-- pg_stat_statements 59일치(6/15~8/13) 계측에서 **1위가 ClassNote 워커의 stale 복구 UPDATE**였다:
--   update lesson_reports set classnote_status='queued'
--    where tenant_id=$1 and classnote_status='processing' and classnote_processing_at < now()-interval
--   → 148,186회 · 총 89분 · 평균 36ms · **최대 20.2초**
-- lesson_reports(19,043행)에 `classnote_status`를 탈 인덱스가 없어서(있던 건 status='queued' 부분
-- 인덱스뿐) **매 15초마다 전수 스캔**을 돌고 있었다. 정작 processing 상태 행은 **0개**다 —
-- 없는 걸 확인하려고 19,043행을 59일간 19만 번 훑은 셈이고, 보고서가 쌓일수록 그 비용이 커진다.
-- 이게 "점점 느려진다"의 물증이다. 같은 인덱스 부재가 발송 콘솔 목록(최대 7.8초)과
-- 상태 카운트(38,273회)에도 걸려 있었다.
--
-- 🔑 seq scan 1회 = 1,513 버퍼(약 12MB)다. shared_buffers가 224MB인 인스턴스에서 이걸 19만 번 돌리면
--    **다른 화면이 쓰던 캐시를 계속 밀어낸다** — 그래서 이 인덱스의 효과는 자기 쿼리(6.1ms→0.04ms)보다
--    "전체가 덜 식는다" 쪽이 크다.
--
-- 적용 후 실측: Seq Scan 6.1ms(19,043행 필터) → **Index Only Scan 0.04ms**.
--
-- ⚠️ 이 파일은 **기록용**이다 — 2026-08-13에 원장이 이미 손으로 적용했다(`if not exists`라 재실행 무해).
--    새 환경 구축 시엔 이 파일로 함께 만들어진다.
-- 되돌리기 = drop index lesson_reports_status_idx, sc_status_updated_idx, ec_status_updated_idx;

-- 1) ClassNote 워커(stale 복구) · 발송 콘솔 목록 · 상태 카운트가 모두 타는 인덱스.
--    열 순서 (tenant_id, classnote_status, classnote_processing_at) — RLS의 tenant 조건이 선두라
--    상태만 거는 PostgREST 목록 쿼리도 같이 커버된다.
create index if not exists lesson_reports_status_idx
  on lesson_reports (tenant_id, classnote_status, classnote_processing_at);

-- 2) 상담 분석 상태 폴링(학생상담) — where processing_status=? and updated_at>=?
--    계측 8,589회 · 평균 166ms(표가 12MB라 전수 스캔이 비쌌다).
create index if not exists sc_status_updated_idx
  on student_consultations (tenant_id, processing_status, updated_at desc);

-- 3) 같은 폴링의 등록상담 쪽 — 계측 1,211회 · 평균 308ms.
create index if not exists ec_status_updated_idx
  on enrollment_consultations (tenant_id, processing_status, updated_at desc);
