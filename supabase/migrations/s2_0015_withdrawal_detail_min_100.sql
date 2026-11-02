-- s2_0015 — 퇴원보고서 상세사유 제출 기준 200자 → 100자 (2026-11-02)
--
-- 왜: 원장 *"퇴원보고서 상세사유 100자 이상으로"*. 앱(`MIN_DETAIL_LENGTH`)만 낮추면 100~199자 제출을
--     DB 전이 함수가 "상세사유 200자 이상과…"로 거절한다.
-- 무엇: 두 함수(묶음 `transition_withdrawal_report` · 한 건 `_v1`)의 글자 수 검사와 거절 문구만 바꾼다.
--     나머지 본문은 운영 함수 그대로(pg_get_functiondef에서 그 조각만 치환 · s2_0009와 같은 방식).
--     이미 제출·승인된 보고서는 다시 검사하지 않는다(제출 순간에만 보는 조건).
-- 순서: **이 SQL을 먼저** 적용하고 앱을 배포한다. 반대면 그 사이 100~199자 제출이 200자 문구로 거절된다.
-- 되돌리기 = scripts/_oneoff/revert-s2_0015-withdrawal-detail-min-100.sql

do $$
declare
  fn text;
  definition text;
  hits int;
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
    hits := (length(definition) - length(replace(definition, old_check, ''))) / length(old_check);
    if hits <> 1 then raise exception 's2_0015: %의 글자 수 검사가 하나가 아닙니다(%건)', fn, hits; end if;
    hits := (length(definition) - length(replace(definition, old_message, ''))) / length(old_message);
    if hits <> 1 then raise exception 's2_0015: %의 거절 문구가 하나가 아닙니다(%건)', fn, hits; end if;
    execute replace(replace(definition, old_check, new_check), old_message, new_message);
  end loop;
end $$;
