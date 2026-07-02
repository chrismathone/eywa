-- 0066a_audience_office.sql (손수 alpha)
-- 공지 audience에 'office'(강사·학생 제외 운영진) 추가 — 사이드바 등 풀셸 전용 공지를
-- 강사(미니셸)에게 안 보이게 타게팅. additive(기존 값·행 무영향).
-- ⚠️ 배포 순서: audienceMatchesRole(구코드)의 unknown 기본값이 true라, 이 값을 쓰는 팝업 행은
--    새 코드가 프로덕션에 배포된 뒤에 만들 것(아니면 강사에게도 노출).
alter type announcement_audience add value if not exists 'office';
