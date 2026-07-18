-- 0123a: 워커 폴러별 마지막 결과를 하트비트에 동봉 (2026-07-19, 원장 지적 "워처 로그 eywa 기록 안 해도 되나").
--
-- 배경: 보고서별 성패(lesson_reports.classnote_*)·워커 생존(classnote_workers.last_seen)은 이미 DB에 있지만,
-- **폴러별 마지막 실행·요약·오류**는 연동 PC 파일 로그(D:/tmp/classnote/watch.log)에만 남았다 —
-- 하트비트는 살아있는데 특정 폴러(읽음 동기화·댓글 감지 등)만 조용히 실패하면 앱에서 안 보였다.
--
-- 해결: 데몬이 매 폴 하트비트 upsert에 last_results jsonb를 동봉. 형태:
--   { "<폴러키>": { "at": ISO시각, ...숫자 요약 } 또는 { "at": ISO, "error": "한 줄" } }
--   폴러키 = queue(발송)·notice(공지)·provision(프로비저닝)·posts(새 글)·comments(댓글)·reads(읽음).
-- 소비 = ClassNote 발송 큐 카드(워커 상태 줄 아래, formatWorkerResults 순수함수가 한글 라벨로 렌더).
-- 쓰기 = 워커(postgres 직결)만 · 읽기 = 기존 tenant_read 정책 그대로. 이력 아님(최신 상태만 — 이력은 파일 로그).
-- ⚠️ drizzle journal 밖(손수 alpha). 신규 DB는 pnpm db:alphas가 사전순 적용.

alter table classnote_workers add column if not exists last_results jsonb;

comment on column classnote_workers.last_results is
  '폴러별 마지막 실행 요약/오류(데몬이 매 폴 동봉): {queue|notice|provision|posts|comments|reads: {at, ...숫자|error}}';
