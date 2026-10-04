begin;
do $$
declare b uuid:='30000000-0000-0000-0000-000000000001'; student uuid:='50000000-0000-0000-0000-000000000001'; j jsonb; helper_definition text;
begin
 if current_database()<>'eywa_source_test' then raise exception 'Fixture DB required'; end if;
 assert tm_sync_private.contact_phone_last4('010-1234-0042','010-5555-6789')='0042';
 assert tm_sync_private.contact_phone_last4(null,'010-5555-0000')='0000';
 assert tm_sync_private.contact_phone_last4(null,'DO_NOT_EXPORT') is null;
 assert not has_function_privilege('authenticated','tm_sync_private.contact_phone_last4(text,text)','execute');
 assert not has_function_privilege('anon','tm_sync_private.contact_phone_last4(text,text)','execute');
 assert not has_function_privilege('service_role','tm_sync_private.contact_phone_last4(text,text)','execute');
 assert (public.tm_sync_schema_health()->>'healthy')::boolean,'Updated exporter must remain healthy';
 assert (select count(*) from tm_sync_private.function_contract)=12,'Contact helper is part of the exact contract';
 select pg_get_functiondef('tm_sync_private.contact_phone_last4(text,text)'::regprocedure) into helper_definition;
 execute $changed$create or replace function tm_sync_private.contact_phone_last4(p_student_phone text,p_parent_phone text)
   returns text language sql immutable set search_path = '' as $body$select null::text$body$;$changed$;
 assert not (public.tm_sync_schema_health()->>'healthy')::boolean,'Changed helper must fail the fingerprint guard';
 execute helper_definition;
 assert (public.tm_sync_schema_health()->>'healthy')::boolean,'Restoring the exact helper restores health';
 delete from tm_sync_private.content_dirty where binding_id=b;
 update public.students set student_phone='010-1234-0042',parent_phone='010-5555-6789' where id=student;
 assert exists(select 1 from tm_sync_private.content_dirty where binding_id=b),'Phone changes request a fresh snapshot';
 j:=tm_sync_private.export_rows(b);
 assert j#>>'{collections,students,0,phoneLast4}'='0042','Snapshot carries student phone tail';
 assert (select array_agg(k order by k) from jsonb_object_keys(j#>'{collections,students,0}') k)
   =array['grade','id','isTest','name','phoneLast4','school','status'],'Student export contains only approved fields';
 assert j::text not like '%010-1234-0042%' and j::text not like '%010-5555-6789%','Full contacts must not leave source';
 update public.students set student_phone=null where id=student;
 assert tm_sync_private.export_rows(b)#>>'{collections,students,0,phoneLast4}'='6789','Registered parent phone is fallback';
 update public.students set parent_phone=null where id=student;
 assert tm_sync_private.export_rows(b)#>'{collections,students,0,phoneLast4}'='null'::jsonb,'Removing source contacts clears the tail';
end; $$;
rollback;
