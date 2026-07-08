-- 0089a: lesson_reports 교재명·보강 컬럼 (edutrix→eywa 강사 필드 패리티 1단계)
-- edutrix 강사가 보고서에 채우던 교재명(textbook)·보강수업 여부(makeup)를 eywa 보고서에도 담아
-- "왜 칸이 없지" 상실감 제거. textbook은 학부모 카드에도 표시(설정 토글 showTextbook), makeup은 기록·원스크린 배지.
alter table lesson_reports add column if not exists textbook text;
alter table lesson_reports add column if not exists makeup boolean not null default false;
