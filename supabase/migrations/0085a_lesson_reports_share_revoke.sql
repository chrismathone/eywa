-- 0085a: 공유 링크 폐기(취소) 메타 — 학부모 공개 보고서(/r/[token])를 강사가 열람 차단(revoke).
-- 만료(보고서일+90일)는 report_date 파생이라 컬럼 불필요(share-expiry.ts). 취소만 상태로 남긴다.
-- nullable 추가 = 테이블 rewrite 없음(0082a 패턴). ALTER ADD COLUMN 자체의 짧은 메타데이터 락만 잡음.
-- revoked_by는 새 컬럼이라 기존행 전부 null → FK 검증 스캔 사실상 없음(단일 ADD로 안전).
alter table lesson_reports add column if not exists revoked_at timestamptz;
alter table lesson_reports add column if not exists revoked_by uuid references users(id) on delete set null;
