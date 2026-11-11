-- s2_0058_staff_delete_blockers.sql — 직원 완전 삭제 사전 검사: 이 직원을 가리켜 삭제를 막는 기록을 센다 · 2026-11-11
-- ✅ 운영 적용 2026-11-11(거래 안 ROLLBACK 시험 뒤 적용 · service_role 전용 실행권 확인 · 신규생 기본 담당 3줄이 잡히는 것 확인).
--
-- 문제(Claude·Codex 검토 H1): 직원 완전 삭제는 ① 로그인 계정(auth)을 지운 뒤 ② public.users를 지운다. aywa-next 이식으로 생긴 새 표들(
--   신규생·여정·업무 문서·관찰·OKR·스튜디오·회계·수집기·AI 검토·배정 상한)이 users(id)를 '지움 규칙 없이' 참조해서, 그 기록이 있는 직원은
--   ②가 23503으로 실패하고 로그인 계정만 사라졌다. 앱의 사전 검사는 출결 기록자 한 곳만 봤다.
-- 고침: 표 이름을 코드에 적지 않고 **DB 카탈로그에서** 직원 행(public.users.id)·로그인 계정(auth.users.id)을 가리키는
--   '삭제를 막는 FK'를 전부 찾아 센다 — NO ACTION · RESTRICT, 그리고 SET NULL인데 칸이 NOT NULL인 것(지우면 23502로 막힌다).
--   → 새 표가 생겨도 저절로 포함되고, 아직 없는 표 때문에 죽지 않는다(있는 것만 본다). 읽기만 한다.
--   + FK가 없는 참조 하나(관찰 기록 문서 속 책임 담당자)는 함수 끝에서 따로 센다.
--   ⚠️ 못 보는 갈래: 지움 규칙이 SET NULL·CASCADE인 표에 '고치지 마라' 트리거가 있으면 삭제가 그 트리거에서 거절된다(예: 학원 비서
--      의견 처리 이력). 그때도 거래째 되돌아가 지워지는 것은 없고, 앱이 '퇴사(비활성)' 안내로 바꿔 보여 준다(delete-blockers.ts).
-- 쓰는 곳 = s2_0060 delete_staff_account(삭제와 **같은 거래**에서 직원 행을 잠근 뒤 부른다 — 검사와 삭제 사이에 기록이 끼어들지 못한다).
-- 보안 정의자: 정책 0개인 서버 전용 표까지 세야 해서 소유자 권한으로 읽는다 · search_path 고정 · service_role만 실행(직원 id 하나의 건수만 돌려준다).
-- 되돌리기 = scripts/_oneoff/revert-s2_0058-staff-delete-blockers.sql
create function public.staff_delete_blockers(p_user uuid)
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
