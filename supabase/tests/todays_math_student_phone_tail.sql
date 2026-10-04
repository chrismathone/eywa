begin;
do $$
declare b uuid:='30000000-0000-0000-0000-000000000001'; student uuid:='50000000-0000-0000-0000-000000000001'; j jsonb;
begin
 if current_database()<>'eywa_source_test' then raise exception 'Fixture DB required'; end if;
 assert tm_sync_private.contact_phone_last4('010-1234-0042','010-5555-6789')='0042';
 assert tm_sync_private.contact_phone_last4(null,'010-5555-0000')='0000';
 assert tm_sync_private.contact_phone_last4(null,'DO_NOT_EXPORT') is null;
 assert not has_function_privilege('authenticated','tm_sync_private.contact_phone_last4(text,text)','execute');
 assert not has_function_privilege('anon','tm_sync_private.contact_phone_last4(text,text)','execute');
 assert (public.tm_sync_schema_health()->>'healthy')::boolean,'Updated exporter must remain healthy';
 delete from tm_sync_private.content_dirty where binding_id=b;
 update public.students set student_phone='010-1234-0042',parent_phone='010-5555-6789' where id=student;
 assert exists(select 1 from tm_sync_private.content_dirty where binding_id=b),'Phone changes request a fresh snapshot';
 j:=tm_sync_private.export_rows(b);
 assert j#>>'{collections,students,0,phoneLast4}'='0042','Snapshot carries student phone tail';
 assert j::text not like '%010-1234-0042%' and j::text not like '%010-5555-6789%','Full contacts must not leave source';
 update public.students set student_phone=null where id=student;
 assert tm_sync_private.export_rows(b)#>>'{collections,students,0,phoneLast4}'='6789','Registered parent phone is fallback';
 update public.students set parent_phone=null where id=student;
 assert tm_sync_private.export_rows(b)#>'{collections,students,0,phoneLast4}'='null'::jsonb,'Removing source contacts clears the tail';
end; $$;
rollback;
