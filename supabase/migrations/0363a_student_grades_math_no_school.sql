-- 수학 성적에 '내신' 칸(exam_slot = 'school')을 다시 못 쓰게 한다 — 원장 2026-10-14 *"성적에서 중간/기말 구분이 필요함"*
-- · *"현재 수학 입력되어있는건 26년도 2학기 중간으로 전체 분류"*. 0289a(수학 중간·기말 → 내신 한 칸)를 되돌리는 쪽.
--
-- 🔴 이 파일만 따로 돌리지 말 것 — 수학 내신 행이 남아 있으면 제약 검사에서 실패한다. 적용은
--    `node --env-file=.env.local scripts/_oneoff/math-school-to-midterm.mjs --apply`가 **같은 트랜잭션** 안에서
--    (내신 → 2026년 2학기 중간고사 이관 + 감사로그) 다음에 이 파일을 실행한다.
-- 🔴 순서 = 새 앱 배포 확인 → 위 스크립트. 옛 앱은 수학 중간·기말을 내신으로 저장한다.
-- 왜 DB에서 막나: 배포 전에 열어 둔 화면은 옛 배포에 붙어 있어 이관 뒤에도 내신으로 저장한다. 막지 않으면 옮긴 중간고사
--    옆에 내신 행이 하나 더 생겨 한 학생의 점수가 두 줄로 갈라진다(에러 없이). 막으면 저장 실패로 드러나고, 새로고침하면
--    새 화면(중간·기말)으로 저장된다.
-- 수학만 막는다 — 내신 칸은 수학에만 있었다(0289a · exam-slots.ts). 되돌리기 = 이 제약 이름을 지운다.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'student_grades_math_no_school_chk') then
    alter table public.student_grades
      add constraint student_grades_math_no_school_chk check (not (subject = 'math' and exam_slot = 'school'));
  end if;
end $$;
