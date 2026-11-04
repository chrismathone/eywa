-- s2_0015 되돌리기 — 퇴원보고서 상세사유 제출 기준을 다시 200자로.
do $$
declare
  fn text;
  definition text;
  old_check constant text := 'char_length(btrim(p_payload->''body''->>''detail''))<200';
  new_check constant text := 'char_length(btrim(p_payload->''body''->>''detail''))<100';
  old_message constant text := '상세사유 200자 이상과';
  new_message constant text := '상세사유 100자 이상과';
begin
  foreach fn in array array[
    'public.transition_withdrawal_report(uuid,uuid,uuid,text,jsonb)',
    'public.transition_withdrawal_report_v1(uuid,uuid,uuid,text,jsonb)'
  ] loop
    select pg_get_functiondef(fn::regprocedure) into definition;
    if position(new_check in definition) = 0 or position(new_message in definition) = 0 then raise exception '되돌릴 줄이 없습니다(%)', fn; end if;
    execute replace(replace(definition, new_check, old_check), new_message, old_message);
  end loop;
end $$;
