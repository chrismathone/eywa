-- s2_0009 — 퇴원보고서 요청 취소: 원장(master)도 남이 요청한 보고서를 취소할 수 있게 (2026-10-29)
--
-- 왜: 원장 *"퇴원보고서 취소가 제대로 안된다는데, 김덕현 기준으로 요청 취소가 왜 안되는지"*.
--     앱(`cancelsAsDirector` = master · 강사 화면 아님)은 원장에게 '요청 취소' 버튼을 주는데, DB 전이 함수 두 개가
--     **요청자 본인만** 취소를 받아 "이 요청을 취소할 수 없습니다."로 거절했다(김덕현 — 요청자 admin, 원장 결재 중 취소 시도).
-- 무엇: 두 함수(묶음 `transition_withdrawal_report` · 한 건 `_v1`)의 취소 조건 한 줄만 바꾼다 — 요청자 본인 **또는**
--     그 지점의 활성 master. 나머지 본문은 운영 함수 그대로(pg_get_functiondef에서 그 한 줄만 치환 · 0369a와 같은 방식).
--     완료·취소된 요청은 종전대로 거절. 강사 화면(teacherView)은 서버 액션이 이미 거른다.
-- 되돌리기 = scripts/_oneoff/revert-s2_0009-withdrawal-cancel-by-director.sql

do $$
declare
  definition text;
  hits int;
  director text := 'not exists(select 1 from public.users u where u.tenant_id=p_tenant and u.id=p_actor and u.status=''active'' and u.system_role::text=''master'')';
begin
  select pg_get_functiondef('public.transition_withdrawal_report(uuid,uuid,uuid,text,jsonb)'::regprocedure) into definition;
  hits := (length(definition) - length(replace(definition, 'if (p_actor is distinct from g.requested_by) or g.status in (''completed'',''canceled'') then raise exception ''이 요청을 취소할 수 없습니다.''', ''))) / length('if (p_actor is distinct from g.requested_by) or g.status in (''completed'',''canceled'') then raise exception ''이 요청을 취소할 수 없습니다.''');
  if hits <> 1 then raise exception 's2_0009: transition_withdrawal_report에서 바꿀 줄이 하나가 아닙니다(%건)', hits; end if;
  execute replace(definition,
    'if (p_actor is distinct from g.requested_by) or g.status in (''completed'',''canceled'') then raise exception ''이 요청을 취소할 수 없습니다.''',
    'if ((p_actor is distinct from g.requested_by) and ' || director || ') or g.status in (''completed'',''canceled'') then raise exception ''이 요청을 취소할 수 없습니다.''');

  select pg_get_functiondef('public.transition_withdrawal_report_v1(uuid,uuid,uuid,text,jsonb)'::regprocedure) into definition;
  hits := (length(definition) - length(replace(definition, 'if (p_actor is distinct from r.requested_by) or r.status in (''completed'',''canceled'') then raise exception ''이 요청을 취소할 수 없습니다.''', ''))) / length('if (p_actor is distinct from r.requested_by) or r.status in (''completed'',''canceled'') then raise exception ''이 요청을 취소할 수 없습니다.''');
  if hits <> 1 then raise exception 's2_0009: transition_withdrawal_report_v1에서 바꿀 줄이 하나가 아닙니다(%건)', hits; end if;
  execute replace(definition,
    'if (p_actor is distinct from r.requested_by) or r.status in (''completed'',''canceled'') then raise exception ''이 요청을 취소할 수 없습니다.''',
    'if ((p_actor is distinct from r.requested_by) and ' || director || ') or r.status in (''completed'',''canceled'') then raise exception ''이 요청을 취소할 수 없습니다.''');
end $$;
