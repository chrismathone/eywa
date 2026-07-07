-- 0082a: lesson_reports 보고서 표시 필드 — 일일/확인테스트·수업태도 분리(학부모 /r 페이지·ClassNote 게시 이미지).
-- 기존 exam_info(합본 문자열)를 일일/확인으로 나누고 attitude(수업태도)를 신규 저장. nullable text 추가는
-- 메타데이터만(테이블 재작성·락 없음). 기존 행은 null → /r가 exam_info로 폴백 표시.
alter table lesson_reports add column if not exists daily_test text;
alter table lesson_reports add column if not exists check_test text;
alter table lesson_reports add column if not exists attitude text;
