-- s2_0065_staff_delete_blockers_journey_owner.sql — 직원 삭제 차단 검사에 콜&상담 여정 기록의 담당자(문서 속 ownerId)를 더한다 · 2026-11-11
-- ✅ 운영 적용 2026-11-11(거래 안 ROLLBACK 시험 뒤 적용 — 여정 기록의 담당자로만 남은 직원이 차단되는 것 · 저장한 사람은 종전대로 FK로 잡히는 것 ·
--    다른 차단 목록이 그대로인 것 · service_role 전용 실행권 확인. 시험 기록은 거래째 되돌렸다 — 여정 기록 0건 그대로).
--
-- 문제(Claude·Codex 검토에서 남은 것): s2_0058 staff_delete_blockers는 직원을 가리키는 FK 전부 + 관찰 기록 문서 속 담당자를 센다.
--   콜&상담 여정 기록(s2_0063)도 담당 직원을 **문서 안**(document->>'ownerId' · FK 없음)에 적는데 이 칸은 못 봤다 —
--   여정 기록의 담당자로만 남은 직원은 완전 삭제가 통과하고, 그 기록은 없는 사람을 담당자로 가리키게 된다.
-- 고침: 같은 함수를 다시 정의한다(본문은 s2_0058 그대로 + 여정 기록 문서 속 담당자 한 갈래). 읽기만 한다 · 표가 없는 DB에서는 건너뛴다.
-- 쓰는 곳 = s2_0060 delete_staff_account(그대로). 실행권(service_role만)은 다시 정의해도 유지되지만 같은 문장을 한 번 더 적어 둔다.
-- 되돌리기 = scripts/_oneoff/revert-s2_0065-staff-delete-blockers-journey-owner.sql (s2_0058의 정의로 되돌린다)
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
  -- FK가 없는 참조 둘째: 콜&상담 여정 기록의 담당자(document->>'ownerId' · s2_0063). 전화·방문·등록 기록마다 담당 직원이 문서 안에 적힌다 —
  -- 그 직원이 지워지면 기록의 담당자가 없는 사람을 가리킨다(집계 제외한 기록도 근거로 남으므로 함께 센다).
  if pg_catalog.to_regclass('public.enrollment_journey_records') is not null then
    execute 'select count(*) from (select 1 from public.enrollment_journey_records where document->>''ownerId'' = $1 limit 1000) s' into n using p_user::text;
    if n > 0 then table_name := 'enrollment_journey_records'; column_name := 'document.ownerId'; ref_count := n; return next; end if;
  end if;
end $$;
revoke all on function public.staff_delete_blockers(uuid) from public, anon, authenticated;
grant execute on function public.staff_delete_blockers(uuid) to service_role;
notify pgrst, 'reload schema';
