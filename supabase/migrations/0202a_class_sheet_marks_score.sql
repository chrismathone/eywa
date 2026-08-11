-- 0202a — ECS 로스터 '점수' 칸 (원장 2026-08-11 "점수 입력칸 신설")
--
-- 학생 한 명의 **그 교시** 기록을 담는 표(class_sheet_student_marks)에 점수 칸 하나를 더한다.
-- 지금 이 표엔 태도(status)와 특이사항(progress_note)뿐이라, 강사들은 점수를 특이사항에 섞어 적고
-- 있었다("Advanced 1 (수능기출 1) PL 7, 15문" 같은 줄). 칸을 나누면 그 줄이 정리된다.
--
-- **왜 text인가** — 실데이터의 자유입력 문화 그대로다. 같은 표의 이웃 칸(page_range)에 이미
-- `25분`·`2강씩`·`프린트물`·`104`가 섞여 있다(실측 326건). 점수도 `18/20`·`95`·`A`가 섞일 것이므로
-- 숫자로 굳히면 못 적는 값이 생긴다. 집계가 필요해지면 그때 파생 컬럼을 따로 만든다.
--
-- ⚠️ 앱은 이 컬럼이 **없어도 돌아간다**(#95, expand/contract). 읽기는 `select("*")`라 없으면 그냥
--    빈 점수이고, 쓰기는 컬럼 부재를 감지해 점수를 뺀 채 다시 저장한 뒤(태도·특이사항은 정상 저장)
--    점수를 실제로 입력한 경우에만 "아직 준비 중"이라고 말한다. 즉 이 SQL을 늦게 적용해도 시트는
--    안 죽고, 적용하는 순간 점수 칸이 살아난다.
--
-- 되돌리기 = alter table class_sheet_student_marks drop column score;
set local statement_timeout = '60s';

alter table class_sheet_student_marks
  add column if not exists score text;

comment on column class_sheet_student_marks.score is
  'ECS 로스터 점수 칸 — 자유 입력(18/20·95·A 등). 0202a, 원장 2026-08-11.';
