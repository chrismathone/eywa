-- Reason choices added by the parallel withdrawal/evaluation change. Preserve the transaction body.
begin;
do $$
declare definition text;
begin
 select pg_get_functiondef('public.transition_withdrawal_report(uuid,uuid,uuid,text,jsonb)'::regprocedure) into definition;
 definition:=replace(definition,
  '''graduated'',''relocation'',''competitor'',''financial'',''schedule'',''dissatisfaction'',''other''',
  '''graduated'',''relocation'',''illness'',''competitor'',''financial'',''schedule'',''dissatisfaction'',''advised'',''other''');
 execute definition;
end $$;
commit;
