-- Optional revised tails. Unedited plans retain their original monthly contract.
do $migration$
begin
  alter table public.math_learning_track_goals add column if not exists plan_revision jsonb;
  alter table public.math_learning_track_goals drop constraint if exists math_learning_track_goals_plan_ck;
  alter table public.math_learning_track_goals add constraint math_learning_track_goals_plan_ck check (
    extract(day from start_date) = 1 and block_count > 0 and
    end_date >= start_date and end_date - start_date <= 3653 and (
      (plan_revision is not null and block_count <= 480) or
      (track = 'regular' and (
        (block_count % 12 = 0 and end_date = (start_date + make_interval(months => block_count / 4) - interval '1 day')::date) or
        (block_count % 24 = 0 and end_date = (start_date + make_interval(months => block_count / 8) - interval '1 day')::date)
      )) or (track = 'supplement' and block_count % 4 = 0 and
        end_date = (start_date + make_interval(months => block_count / 4) - interval '1 day')::date)
    )
  );
  alter table public.math_learning_track_goals drop constraint if exists math_learning_track_goals_revision_ck;
  alter table public.math_learning_track_goals add constraint math_learning_track_goals_revision_ck check (
    (plan_revision is null or (
      jsonb_typeof(plan_revision) = 'object' and
      jsonb_typeof(plan_revision -> 'effectiveDate') = 'string' and
      jsonb_typeof(plan_revision -> 'anchor') in ('object', 'null') and
      jsonb_typeof(plan_revision -> 'lockedStops') = 'number' and
      jsonb_typeof(plan_revision -> 'pastDays') = 'array' and
      jsonb_array_length(plan_revision -> 'pastDays') <= 4000
    )) is true
  );
  comment on column public.math_learning_track_goals.plan_revision is 'Server-derived revision date, current lesson anchor, protected stops and earlier planned lesson positions';
  notify pgrst, 'reload schema';
end
$migration$;
