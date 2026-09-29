-- A video homework check is one result per student/class/lesson date.
-- The old round number was only a spreadsheet column and did not identify a lesson.
alter table public.video_homework_marks
  add column if not exists check_date date;
alter table public.video_homework_marks
  add column if not exists homework_date date;

-- Preserve any checks entered before this change on their local entry date.
update public.video_homework_marks
set check_date = (updated_at at time zone 'Asia/Seoul')::date
where check_date is null;

alter table public.video_homework_marks
  alter column check_date set not null;
alter table public.video_homework_marks
  drop constraint if exists video_homework_marks_unique;
alter table public.video_homework_marks
  drop column if exists round_no;

create unique index if not exists video_homework_marks_lesson_uq
  on public.video_homework_marks (tenant_id, class_id, student_id, check_date);

alter table public.video_homework_marks
  add constraint video_homework_marks_homework_date_ck
  check (homework_date is null or homework_date <= check_date);

create index if not exists video_homework_marks_date_idx
  on public.video_homework_marks (tenant_id, check_date, class_id);

notify pgrst, 'reload schema';
