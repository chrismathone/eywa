-- 0206a — ECS 로스터 **JJ(집중자율수업실) 전용 폼** 칸 2개
--
-- 원장 2026-08-13: *"JJ 수업만 특별한 커스텀 폼을 가지게 해야겠어. 점수를 없애고 듣기 레벨,
-- 누적 암기 단어수를 추가해줘. 이건 그냥 텍스트 입력으로."*
--
-- JJ는 사람이 아니라 **자리**(305호, 전담자 없이 강사들이 번갈아 감독 — teacher-label.ts)라 하는 일이
-- 강사 수업과 다르다: 시험을 보는 자리가 아니라 듣기·단어 암기를 쌓는 자리다. 그래서 같은 표를 쓰되
-- 화면에 뜨는 칸만 갈린다(실측 2026-08-13: live JJ 슬롯 48개 · 최근 60일 JJ 교시 마크 1,155건).
--
-- **왜 text인가** — 0202a `score`와 같은 이유. 이웃 칸(page_range)에 `25분`·`2강씩`·`프린트물`이 섞여
-- 있는 자유입력 문화다. `Level 3`·`3-2`·`1,250개`가 섞일 것이므로 숫자로 굳히면 못 적는 값이 생긴다.
-- 집계가 필요해지면 그때 파생 컬럼을 따로 만든다.
--
-- ⚠️ 앱은 이 컬럼들이 **없어도 돌아간다**(#95, expand/contract). 읽기는 `select("*")`라 없으면 빈 칸이고,
--    쓰기는 컬럼 부재를 감지해 그 칸을 뺀 채 다시 저장한 뒤(태도·특이사항은 정상 저장) 값을 실제로
--    입력한 경우에만 "아직 준비 중"이라고 말한다. 즉 이 SQL을 늦게 적용해도 시트는 안 죽고,
--    적용하는 순간 두 칸이 살아난다.
--
-- 되돌리기 = alter table class_sheet_student_marks
--              drop column listening_level, drop column memorized_words;
set local statement_timeout = '60s';

alter table class_sheet_student_marks
  add column if not exists listening_level text,
  add column if not exists memorized_words text;

comment on column class_sheet_student_marks.listening_level is
  'ECS JJ 전용 — 듣기 레벨(자유 입력). 0206a, 원장 2026-08-13.';
comment on column class_sheet_student_marks.memorized_words is
  'ECS JJ 전용 — 누적 암기 단어수(자유 입력). 0206a, 원장 2026-08-13.';
