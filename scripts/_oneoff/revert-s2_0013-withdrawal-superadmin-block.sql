-- s2_0013 되돌리기 — superadmin 거부와 원장 알림 제목을 뺀다.
-- 청구 회차 12행(subject_1 → math)은 수학(심화) 폐지라 되돌리지 않는다.
do $$
declare
  definition text;
  guard text := ' and not coalesce(public.is_super_admin(id),false)';
  o text;
begin
  select pg_get_functiondef('public.request_withdrawal_report_group(uuid,uuid,jsonb)'::regprocedure) into definition;
  o := 'system_role::text in (''admin'',''manager'',''master'')' || guard || ')) then raise exception ''현재 재직 중인 승인 관리자를 선택해 주세요.''';
  if position(o in definition) = 0 then raise exception '되돌릴 줄이 없습니다(요청 함수)'; end if;
  execute replace(definition, o, 'system_role::text in (''admin'',''manager'',''master''))) then raise exception ''현재 재직 중인 승인 관리자를 선택해 주세요.''');

  select pg_get_functiondef('public.transition_withdrawal_report(uuid,uuid,uuid,text,jsonb)'::regprocedure) into definition;
  o := 'headline:=case when cardinality(g.director_ids)=0 and not exists(select 1 from unnest(g.manager_ids) x where not exists(select 1 from public.users u where u.id=x and u.tenant_id=p_tenant and u.system_role::text=''master'')) then ''퇴원보고서 원장 승인 요청'' else ''퇴원보고서 관리자 승인 요청'' end;';
  if position(o in definition) = 0 then raise exception '되돌릴 줄이 없습니다(전이 함수)'; end if;
  execute replace(definition, o, 'headline:=''퇴원보고서 관리자 승인 요청'';');

  select pg_get_functiondef('public.transition_withdrawal_report_v1(uuid,uuid,uuid,text,jsonb)'::regprocedure) into definition;
  o := 'system_role::text in (''manager'',''admin'',''master'')' || guard || ') then raise exception ''승인할 관리자를 지정해 주세요.''';
  if position(o in definition) = 0 then raise exception '되돌릴 줄이 없습니다(_v1 관리자)'; end if;
  definition := replace(definition, o, 'system_role::text in (''manager'',''admin'',''master'')) then raise exception ''승인할 관리자를 지정해 주세요.''');
  o := 'system_role::text=''master''' || guard || ') then raise exception ''승인할 원장을 지정해 주세요.''';
  if position(o in definition) = 0 then raise exception '되돌릴 줄이 없습니다(_v1 원장)'; end if;
  execute replace(definition, o, 'system_role::text=''master'') then raise exception ''승인할 원장을 지정해 주세요.''');
end $$;
