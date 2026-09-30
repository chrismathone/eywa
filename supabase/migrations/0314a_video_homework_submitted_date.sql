-- Actual submission date is separate from the lesson/check date and the prior homework date.
-- Old checks have no known submission date; do not invent one from check_date/updated_at.
alter table public.video_homework_marks
  add column if not exists submitted_date date;

comment on column public.video_homework_marks.submitted_date
  is 'Actual video homework submission date entered by staff; NULL when not recorded.';

notify pgrst, 'reload schema';
