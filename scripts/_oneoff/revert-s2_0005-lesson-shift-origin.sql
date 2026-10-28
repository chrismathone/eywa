-- s2_0005 되돌리기 — 표식 출처 칸을 지운다. 이동이 쓴 표식은 skip 그대로 남는다(원래 계획엔 다시 반영되지 않음 = 종전).
-- 앱은 칸이 없어도 돈다(읽기·쓰기 모두 칸 없이 다시 시도).
alter table public.class_lesson_shifts drop constraint if exists class_lesson_shifts_origin_chk;
alter table public.class_lesson_shifts drop column if exists origin;
notify pgrst, 'reload schema';
