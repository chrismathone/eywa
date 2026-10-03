-- Real PostgreSQL regression for JSON-string escaping at the HTTP boundary.
-- Self-contained, rolled back, and restricted to dedicated local fixtures.
begin;
do $$ begin
 if current_database() not in ('eywa_source_test','eywa_e2e_source') then
  raise exception 'Isolated fixture database required';
 end if;
end; $$;
do $$
declare t uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); u uuid:=gen_random_uuid();
 c uuid:=gen_random_uuid(); s uuid:=gen_random_uuid(); r uuid:=gen_random_uuid();
 m jsonb; p jsonb; raw_page text; before_gen bigint; before_snapshots bigint; before_pages bigint;
begin
 insert into public.tenants(id,slug,name) values(t,'byte-fixture-'||t,'Byte fixture');
 insert into public.tenant_licenses(tenant_id,feature,is_active) values(t,'todays_math',true);
 insert into auth.users(id,email) values(u,'byte-fixture@example.invalid');
 insert into public.users(id,tenant_id,email,display_name,system_role,status,subjects)
  values(u,t,'byte-fixture@example.invalid','Byte fixture','teacher','active',array['math']);
 insert into public.classes(id,tenant_id,class_name,subject,teacher_id) values(c,t,'Byte class','math',u);
 insert into public.students(id,tenant_id,name,status) values(s,t,'Byte student','enrolled');
 insert into public.enrollments(tenant_id,student_id,class_id,start_date)
  values(t,s,c,(now() at time zone 'Asia/Seoul')::date);
 insert into public.lesson_reports(id,tenant_id,student_id,class_id,subject,report_date,progress)
  values(r,t,s,c,'math',(now() at time zone 'Asia/Seoul')::date,repeat(chr(34)||chr(92),260000));
 perform public.tm_sync_configure_binding(b,t,'byte-branch-'||b,'shadow',true);
 perform public.tm_sync_configure_binding(b,t,'byte-branch-'||b,'active',true);

 -- About 2.08 MB on the wire: large escaped content below the actual limit works.
 m:=public.tm_sync_create_snapshot(b);
 p:=public.tm_sync_snapshot_page(b,(m->>'snapshotId')::uuid,'progress',0);
 assert octet_length(p::text)<=2097152,'Serialized page must fit shared 2 MiB body limit';
 assert octet_length(p::text)>2000000,'Regression exercises the real wire boundary';
 assert p->>'sha256'=tm_sync_private.hash(p->>'json'),'Hash remains over exact inner JSON string';
 assert ((p->>'json')::jsonb#>>'{0,progress}')=repeat(chr(34)||chr(92),260000),'No lossy truncation';

 -- This was accepted by the former 1.5 MB inner-string check, but its enclosing
 -- Page response is over 2.4 MB because all quotes/backslashes are escaped again.
 update public.lesson_reports set progress=repeat(chr(34)||chr(92),300000) where id=r;
 raw_page:=(tm_sync_private.export_rows(b)#>'{collections,progress}')::text;
 assert octet_length(raw_page)<1500000,'Old inner-string limit would accept this page';
 assert octet_length(jsonb_build_object('json',raw_page)::text)>2097152,'Outer JSON exceeds HTTP limit';
 select content_generation into before_gen from tm_sync_private.export_state where binding_id=b;
 select count(*) into before_snapshots from tm_sync_private.snapshots where binding_id=b;
 select count(*) into before_pages from tm_sync_private.pages;
 begin
  perform public.tm_sync_create_snapshot(b);
  raise exception 'Oversized escaped Page was incorrectly accepted';
 exception when sqlstate 'PTS04' then null;
 end;
 assert (select content_generation from tm_sync_private.export_state where binding_id=b)=before_gen,'Rejected export rolls back generation';
 assert (select count(*) from tm_sync_private.snapshots where binding_id=b)=before_snapshots,'Rejected export leaves no partial manifest';
 assert (select count(*) from tm_sync_private.pages)=before_pages,'Earlier collections in rejected snapshot roll back';
 assert public.tm_sync_snapshot_page(b,(m->>'snapshotId')::uuid,'progress',0)=p,'Prior frozen export remains available';

 update public.lesson_reports set progress=repeat('한'||chr(34)||chr(92)||chr(10),100000) where id=r;
 m:=public.tm_sync_create_snapshot(b);
 p:=public.tm_sync_snapshot_page(b,(m->>'snapshotId')::uuid,'progress',0);
 assert octet_length(p::text)<=2097152,'UTF-8 and control-character escaping both count as bytes';
 assert p->>'sha256'=tm_sync_private.hash(p->>'json');
 assert ((p->>'json')::jsonb#>>'{0,progress}')=repeat('한'||chr(34)||chr(92)||chr(10),100000);
end; $$;
rollback;
