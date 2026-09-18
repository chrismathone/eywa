-- A class has one teaching track. Goals can span courses and retain numbered stops.
alter table public.classes add column if not exists math_learning_track text not null default 'regular'
  check (math_learning_track in ('regular', 'supplement'));

alter table public.math_learning_track_goals
  add column if not exists end_study_grade text,
  add column if not exists milestones jsonb not null default '[]'::jsonb;
alter table public.math_learning_track_goals drop constraint if exists math_learning_track_goals_plan_ck;
alter table public.math_learning_track_goals add constraint math_learning_track_goals_plan_ck check (
  extract(day from start_date) = 1 and block_count > 0 and
  end_date >= start_date and end_date - start_date <= 3653 and
  ((track = 'regular' and block_count % 24 = 0 and
    end_date = (start_date + make_interval(months => block_count / 8) - interval '1 day')::date)
   or (track = 'supplement' and block_count % 4 = 0 and
    end_date = (start_date + make_interval(months => block_count / 4) - interval '1 day')::date))
);
alter table public.math_learning_track_goals drop constraint if exists math_learning_track_goals_milestones_ck;
alter table public.math_learning_track_goals add constraint math_learning_track_goals_milestones_ck
  check (jsonb_typeof(milestones) = 'array' and jsonb_array_length(milestones) <= 100);
notify pgrst, 'reload schema';
