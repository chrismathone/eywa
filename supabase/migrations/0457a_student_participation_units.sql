-- Additive guards only: old rows and old writers remain valid. No closed-month rewrite.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
create function public.guard_student_participation_units() returns trigger
language plpgsql set search_path = public as $$
declare part jsonb; metric text;
begin
  foreach part in array array[new.raws,new.correction] loop
    foreach metric in array array['perfectWeeks','videoAssignments'] loop
      if part ? metric and (jsonb_typeof(part->metric) <> 'number'
        or (part->>metric) !~ '^-?[0-9]+$' or abs((part->>metric)::numeric) > 9007199254740991) then
        raise exception '학습·참여 실적의 수치를 확인해 주세요';
      end if;
    end loop;
  end loop;
  return new;
end; $$;
create trigger student_participation_units_guard before insert or update on public.student_contribution_months
  for each row execute function public.guard_student_participation_units();
commit;
