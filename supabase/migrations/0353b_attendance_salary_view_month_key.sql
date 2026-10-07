-- 0353b — '합계 및 실급여 보여주기' 달별 저장의 둘째 단계(줄이기). 0353a를 읽는 앱이 나간 **뒤에** 적용한다.
--
-- 옛 기본키(지점 · 선생님)를 떼야 한 선생님에게 달이 다른 줄을 둘 이상 둘 수 있다. 새 키(지점 · 선생님 · 달)를 기본키로 삼고,
-- 달 기본값('2026-09' — 0353a가 그때 켜져 있던 줄을 9월로 옮기려고 둔 값)을 뗀다. 이제 달 없이 쓰면 거절된다.
--
-- 🔴 한 덩어리(`do`)로 실행한다 — `using index`는 인덱스 이름을 기본키 이름으로 바꾸므로, 문장을 따로따로 두 번 돌리면
--    둘째 실행이 새 기본키를 떼고 "인덱스 없음"에서 멈춰 유니크 키가 하나도 안 남는다. 새 인덱스가 아직 있을 때만(= 첫 실행) 바꾼다.
do $$
begin
  set local lock_timeout = '3s';
  if exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'attendance_salary_teacher_view' and indexname = 'attendance_salary_teacher_view_month_key'
  ) then
    alter table public.attendance_salary_teacher_view drop constraint if exists attendance_salary_teacher_view_pkey;
    alter table public.attendance_salary_teacher_view
      add constraint attendance_salary_teacher_view_pkey primary key using index attendance_salary_teacher_view_month_key;
  end if;
  alter table public.attendance_salary_teacher_view alter column period drop default;
  notify pgrst, 'reload schema';
end
$$;
