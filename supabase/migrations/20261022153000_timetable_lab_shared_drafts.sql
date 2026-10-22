-- Share immutable practice snapshots with permitted editors in the same branch.
-- Creation still records the authenticated author; other branches remain inaccessible.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

drop policy if exists timetable_lab_drafts_read_own on public.timetable_lab_drafts;
drop policy if exists timetable_lab_drafts_read_tenant on public.timetable_lab_drafts;
create policy timetable_lab_drafts_read_tenant on public.timetable_lab_drafts
for select to authenticated
using (tenant_id = (select public.auth_tenant_id()) and (select public.auth_can_use_timetable_lab()));

create index if not exists timetable_lab_drafts_tenant_list_idx
  on public.timetable_lab_drafts (tenant_id, subject, created_at desc, id desc);

comment on table public.timetable_lab_drafts is 'Branch-shared immutable timetable practice snapshots, attributed to their creators; never applied to operating schedules automatically.';
commit;
