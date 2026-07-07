-- 0081a: lesson_reports 공유 토큰 — 학부모 공개 보고서 링크(/r/[token]) 기반. 멱등 + 락 최소화.
-- 강사 원스크린 "카톡용/문자용 저장"이 이 토큰으로 공개 URL을 만들어 학부모에게 전달(발송 시스템 이식 P0).
-- 공개 페이지는 service_role(admin)로 share_token → 단건 조회(RLS 우회). 전역 유니크 토큰이 테넌트를
-- 해석하므로 테넌트 누수 없음((intake) 공개 토큰 패턴과 동일).
--
-- ⚠️ `ADD COLUMN NOT NULL DEFAULT gen_random_uuid()`는 volatile default라 전 테이블 재작성(ACCESS
-- EXCLUSIVE 락)을 유발한다. 공유 프로덕션 DB 보호를 위해 4단계로 분리:
--   ① nullable 컬럼 추가(메타데이터만, 즉시)  ② 기존 행 백필(온라인, 읽기 안 막음)
--   ③ 향후 insert용 default 설정(메타데이터만)  ④ NOT NULL 부여(스캔은 하되 재작성 없음).
alter table lesson_reports add column if not exists share_token uuid;
update lesson_reports set share_token = gen_random_uuid() where share_token is null;
alter table lesson_reports alter column share_token set default gen_random_uuid();
alter table lesson_reports alter column share_token set not null;

create unique index if not exists lesson_reports_share_token_key
  on lesson_reports (share_token);
