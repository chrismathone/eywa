-- 성적 칸에 **'시험없음'(사유 포함)** + 수학의 새 시험 칸(내신·월말평가) — 원장 2026-09-22.
-- 멱등. 0283a·0284a 다음.
--
-- 🔑 '시험없음'은 사람이 누르는 사실이다(사유를 받는다) — **제도상 해당 없음**(초등·중1의 중간·기말)과
--    다른 축이라 DB에 남기지 않는다(그쪽은 학년에서 그때그때 도출한다, `applies.ts`).
-- 🔴 점수와 '시험없음'은 같이 설 수 없다 — 켜면 점수를 비운다(앱이 지킨다).
alter table public.student_grades
  add column if not exists no_exam boolean not null default false,
  add column if not exists no_exam_reason text;

-- 시험 칸 목록이 늘었다(수학: 내신·월말평가). 옛 제약을 떼고 새로 건다 — 값 집합만 넓히는 변경이라
-- 기존 행(midterm·final·listening)은 전부 그대로 통과한다.
alter table public.student_grades drop constraint if exists student_grades_slot_chk;
alter table public.student_grades
  add constraint student_grades_slot_chk
  check (exam_slot is null or exam_slot in ('listening', 'midterm', 'final', 'school', 'monthly'));

notify pgrst, 'reload schema';
