-- s2_0065 되돌리기 — 직원 삭제 차단 검사를 s2_0058의 정의로 되돌린다(콜&상담 여정 기록의 문서 속 담당자를 다시 세지 않는다).
-- 🔴 적용 SQL이 아니다. 함수를 지우지 않고 **다시 정의**한다 — s2_0060 delete_staff_account가 이 함수를 부른다.
create or replace function public.staff_delete_blockers(p_user uuid)
returns table(table_name text, column_name text, ref_count bigint)
language plpgsql stable security definer set search_path = '' as $$
declare r record; n bigint;
begin
  for r in
    select cl.relname::text as tbl, a.attname::text as col
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_class cl on cl.oid = c.conrelid
    join pg_catalog.pg_namespace ns on ns.oid = cl.relnamespace
    -- 여러 칸 FK(tenant_id, user_id)도 users.id에 대응하는 칸을 고른다.
    join lateral unnest(c.conkey, c.confkey) as k(conattnum, confattnum) on true
    join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.conattnum
    join pg_catalog.pg_attribute ra on ra.attrelid = c.confrelid and ra.attnum = k.confattnum
    where c.contype = 'f' and c.confrelid in ('public.users'::regclass, 'auth.users'::regclass) and ns.nspname = 'public'
      and (c.confdeltype in ('a', 'r') or (c.confdeltype = 'n' and a.attnotnull))
      and ra.attname = 'id' and cl.relkind in ('r', 'p')
    order by 1, 2
  loop
    -- 건수는 안내 문구용이라 1,000에서 멈춘다(큰 표를 다 세지 않는다).
    execute pg_catalog.format('select count(*) from (select 1 from public.%I where %I = $1 limit 1000) s', r.tbl, r.col) into n using p_user;
    if n > 0 then table_name := r.tbl; column_name := r.col; ref_count := n; return next; end if;
  end loop;
  -- FK가 없는 참조 하나: 관찰 기록의 책임 담당자(document->>'ownerId' · s2_0049). 그 직원이 지워지면 그 후속 조치·운영 목표는
  -- 다음 저장에서 '담당자를 확인해 주세요'로 막힌다 — 담당으로 지정된 기록이 있으면 삭제를 막는다(표가 아직 없는 DB에서는 건너뛴다).
  if pg_catalog.to_regclass('public.academy_knowledge_records') is not null then
    execute 'select count(*) from (select 1 from public.academy_knowledge_records where document->>''ownerId'' = $1 limit 1000) s' into n using p_user::text;
    if n > 0 then table_name := 'academy_knowledge_records'; column_name := 'document.ownerId'; ref_count := n; return next; end if;
  end if;
end $$;
revoke all on function public.staff_delete_blockers(uuid) from public, anon, authenticated;
grant execute on function public.staff_delete_blockers(uuid) to service_role;
notify pgrst, 'reload schema';
