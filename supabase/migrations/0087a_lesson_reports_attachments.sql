-- 0087a: 수업 보고서 학생 사진 첨부(P2b) — jsonb 배열 [{path,name,size}].
-- 강사가 학생 풀이 사진을 붙이면 학부모 공개 링크(/r/[token])와 ClassNote 게시글(스크린샷)에 함께 노출.
-- 0035b(expenses.receipt_urls) 선례 미러: 상수 default('[]')라 테이블 rewrite 없음(짧은 메타데이터 락).
-- 파일은 report-attachments 버킷(private, admin signed URL 양방향)에 저장 → storage RLS 불요(document/branding 방식).
alter table lesson_reports add column if not exists attachments jsonb not null default '[]'::jsonb;
