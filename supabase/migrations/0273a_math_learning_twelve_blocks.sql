-- A semester now contains 12 blocks over the same three months (4 blocks/month).
-- Accept old 24-block rows during rollout. The app normalizes them on read, and
-- future goal extensions save 12-block units without changing earlier dates.
begin;
alter table public.math_learning_track_goals drop constraint if exists math_learning_track_goals_plan_ck;
alter table public.math_learning_track_goals add constraint math_learning_track_goals_plan_ck check (
  extract(day from start_date) = 1 and block_count > 0 and
  end_date >= start_date and end_date - start_date <= 3653 and
  ((track = 'regular' and (
    (block_count % 12 = 0 and end_date = (start_date + make_interval(months => block_count / 4) - interval '1 day')::date)
    or (block_count % 24 = 0 and end_date = (start_date + make_interval(months => block_count / 8) - interval '1 day')::date)
  )) or (track = 'supplement' and block_count % 4 = 0 and
    end_date = (start_date + make_interval(months => block_count / 4) - interval '1 day')::date))
);
notify pgrst, 'reload schema';
commit;
