-- s2_0023 — 성적 칸의 영역 점수(영어 Monthly Test 듣기·읽기·말하기·쓰기) (2026-11-04)
--
-- 왜: 원장 *"monthly test 결과 담을 수 있는 … 듣기 읽기 말하기 쓰기 총합 이렇게 들어가게 총합은 자동 SUM"*.
--     영어에도 월말 시험 칸(exam_slot 'monthly', 화면 이름 'Monthly Test')을 열고, 네 영역 값을 이 칸에 함께 둔다.
-- 무엇: public.student_grades에 nullable jsonb 칸 하나(area_scores)만 더한다. 기본값·색인 없음 — 기존 줄은 null 그대로.
--   · score(총합)는 지금처럼 그 행의 점수다 — 추이·평균·학생 상세는 총합으로 그대로 돈다. 영역 키 = listening·reading·speaking·writing.
--   · 모양 검사만 건다(객체이거나 null) — 키·값 검사는 앱(src/features/grades/area-scores.ts)이 한다.
--   · exam_slot 제약(listening·midterm·final·school·monthly)·월 축 제약(exam_month는 monthly만)은 그대로 — 영어 monthly도 이미 허용된다.
--   · 권한은 표 단위(기존 tenant 격리 정책)라 새 칸도 그대로 읽고 쓴다.
-- 적용 순서: 상관없음([[#95]]) — 웹은 이 칸이 없으면 영역 입력만 잠그고(사유 표시) 나머지 성적 화면은 그대로 돈다.
-- 적용 확인(읽기만):
--   select count(*) from information_schema.columns
--    where table_schema = 'public' and table_name = 'student_grades' and column_name = 'area_scores';   -- 기대: 1
--
-- 되돌리기: alter table public.student_grades drop column if exists area_scores;

begin;
set local lock_timeout = '3s';

alter table public.student_grades
  add column if not exists area_scores jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'student_grades_area_scores_object_chk') then
    alter table public.student_grades
      add constraint student_grades_area_scores_object_chk
      check (area_scores is null or jsonb_typeof(area_scores) = 'object');
  end if;
end $$;

comment on column public.student_grades.area_scores is
  '영역 점수(영어 Monthly Test 듣기·읽기·말하기·쓰기) — score는 이 값들의 합. 없으면 null. s2_0023';

commit;

notify pgrst, 'reload schema';
