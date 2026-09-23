-- 수학 중간·기말 입력을 내신 한 칸으로 통합한다. 기존 점수는 모두 보존한다.
-- 같은 학생·학기에 여러 행이 있다면 가장 최근 한 행만 내신 키로 옮기고,
-- 나머지는 이전 키로 남겨 통합 원장에서 계속 조회·수정할 수 있게 한다.
begin;

with ranked as (
  select id, tenant_id, student_id, subject, school_year, term, exam_month,
         row_number() over (
           partition by tenant_id, student_id, subject, school_year, term, exam_month
           order by taken_on desc, id desc
         ) as position
    from public.student_grades
   where subject = 'math' and exam_slot in ('midterm', 'final')
), movable as (
  select candidate.id
    from ranked candidate
   where candidate.position = 1
     and not exists (
       select 1 from public.student_grades current_grade
        where current_grade.tenant_id = candidate.tenant_id
          and current_grade.student_id = candidate.student_id
          and current_grade.subject = candidate.subject
          and current_grade.school_year is not distinct from candidate.school_year
          and current_grade.term is not distinct from candidate.term
          and current_grade.exam_month = candidate.exam_month
          and current_grade.exam_slot = 'school'
     )
)
update public.student_grades grade
   set exam_slot = 'school', exam_name = '내신'
  from movable
 where grade.id = movable.id;

update public.student_grades
   set exam_name = '내신'
 where subject = 'math' and exam_slot in ('midterm', 'final');

commit;
notify pgrst, 'reload schema';
