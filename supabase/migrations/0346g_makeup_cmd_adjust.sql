-- 0346g — 명령: 인정 반전(reverse) · 면제(waive) · 수량/기한 조정(adjust)
--
-- 셋 다 원장·관리자만 한다. 원래 기록을 덮어쓰지 않고 **결정 기록을 덧붙인다**.
--   · 반전: 그 실시의 인정 배분을 **그대로 한 번** 되돌린다(인정 행마다 반전 행 하나 — 유니크로 두 번은 불가).
--     남은 의무(O)는 그만큼 돌아오지만 **옛 좌석·배정은 되살리지 않는다**(되돌린 분은 해제량으로 남는다).
--     닫혀 있던 케이스는 다시 열린다. 실제 출결·시수·급여·청구는 건드리지 않는다 — 그쪽 정정은 별도 권한의 일이다.
--   · 면제: 살아 있는 일정이 있으면 거절하고 목록을 돌려준다(연쇄 취소 없음 — 일정을 따로 취소한 뒤 다시 요청하면
--     같은 잠금에서 다시 검사한다). 남은 의무보다 많이 면제할 수 없다. 남은 의무가 0이 되면 자동 종결.
--   · 수량 조정: 목표량을 늘리거나 줄인다(부호 있는 분). 점유(C)보다 작게 줄일 수 없고, 0으로 만드는 것은 면제의 일이다.
--     면제는 waiver 한 곳에서만 뺀다 — 같은 분을 조정과 면제에 두 번 넣지 않는다.
--   · 기한 조정: 승인된 건의 처리 기한을 사유와 함께 바꾼다(기한이 지났다고 자동 소멸하지 않는다).
-- 멱등: create or replace.

create or replace function makeup_private.cmd_reverse(a makeup_private.actor_ctx, p_cmd uuid, p jsonb, p_rev integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid := makeup_private.p_uuid(p, 'fulfillment_id');
  v_reason text := makeup_private.p_text(p, 'reason');
  v_f public.makeup_fulfillments%rowtype;
  v_cases uuid[];
  v_r public.makeup_recognitions%rowtype;
  v_case uuid;
  v_c public.makeup_cases%rowtype;
begin
  perform makeup_private.require_level(a, 'privileged');
  select * into v_f from public.makeup_fulfillments f where f.id = v_id and f.tenant_id = a.tenant_id;
  if not found then perform makeup_private.fail('not_found', '실시 기록을 찾을 수 없습니다'); end if;
  if v_reason is null then perform makeup_private.fail('invalid', '정정 사유를 적어 주세요'); end if;
  select array_agg(al.case_id order by al.case_id) into v_cases
    from public.makeup_allocations al where al.participant_id = v_f.participant_id;
  perform makeup_private.lock_cases(a.tenant_id, coalesce(v_cases, '{}'::uuid[]));
  perform 1 from public.makeup_participants x where x.id = v_f.participant_id for update;
  select * into v_f from public.makeup_fulfillments f where f.id = v_id for update;
  perform makeup_private.check_revision(p_rev, v_f.revision);
  if v_f.state <> 'verified' then
    perform makeup_private.fail('conflict', '검토를 마친 기록만 정정할 수 있습니다');
  end if;
  for v_r in select r.* from public.makeup_recognitions r
              where r.fulfillment_id = v_id and r.kind = 'recognize'
                and not exists (select 1 from public.makeup_recognitions x where x.reversal_of = r.id)
              order by r.id loop
    insert into public.makeup_recognitions (tenant_id, fulfillment_id, allocation_id, case_id, participant_id, kind,
        minutes, effect_key, reversal_of, reason, decided_by)
      values (a.tenant_id, v_id, v_r.allocation_id, v_r.case_id, v_r.participant_id, 'reverse', v_r.minutes,
        'rev:' || v_r.id::text, v_r.id, left(v_reason, 500), a.user_id);
    -- 인정에서 빼고 해제로 옮긴다 — 점유(좌석)는 되살아나지 않는다.
    update public.makeup_allocations al
       set recognized_minutes = al.recognized_minutes - v_r.minutes,
           released_minutes = al.released_minutes + v_r.minutes, release_reason = 'reversed'
     where al.id = v_r.allocation_id;
  end loop;
  update public.makeup_fulfillments f set state = 'reversed', reverse_reason = left(v_reason, 500)
   where f.id = v_id returning * into v_f;
  -- 되돌린 실시 기록의 보고서 증거 항목(0349f)은 더 볼 것이 없다 — 증거가 바뀌었을 때의 처리 = 인정 되돌리기.
  update public.makeup_reconciliation r
     set state = 'resolved', resolved_at = now(), resolved_by = a.user_id, resolution_note = '인정을 되돌렸습니다',
         detail = r.detail || '{"auto_resolved": true}'::jsonb
   where r.tenant_id = a.tenant_id and r.dedupe_key = 'evidence_report:' || v_id::text and r.state = 'open';
  foreach v_case in array coalesce(v_cases, '{}'::uuid[]) loop
    perform makeup_private.recompute_case(v_case);
    select * into v_c from public.makeup_cases c where c.id = v_case;
    if v_c.lifecycle = 'closed' and v_c.closure_reason in ('completed', 'completed_with_waiver') and v_c.outstanding_minutes > 0 then
      update public.makeup_cases c set lifecycle = 'open', closure_reason = null, closed_at = null where c.id = v_case;
      perform makeup_private.log_event(a.tenant_id, 'case', v_case, 'reopened', a.user_id, p_cmd, v_case, null, v_reason);
    end if;
    perform makeup_private.log_event(a.tenant_id, 'fulfillment', v_id, 'recognition_reversed', a.user_id, p_cmd, v_case, null,
      v_reason, jsonb_build_object('participant_id', v_f.participant_id));
  end loop;
  perform makeup_private.audit(a, 'reverse', '보강 인정 정정', jsonb_build_object('command_id', p_cmd, 'fulfillment_id', v_id));
  return makeup_private.result('reverse', v_id, v_f.revision, 'rev:' || v_id::text, coalesce(v_cases, '{}'::uuid[]),
    jsonb_build_object('fulfillment_id', v_id, 'participant_id', v_f.participant_id, 'state', 'reversed'));
end;
$$;

create or replace function makeup_private.cmd_waive(a makeup_private.actor_ctx, p_cmd uuid, p jsonb, p_rev integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid := makeup_private.p_uuid(p, 'case_id');
  v_minutes integer := makeup_private.p_int(p, 'minutes');
  v_reason text := makeup_private.p_text(p, 'reason');
  v_c public.makeup_cases%rowtype;
begin
  perform makeup_private.require_level(a, 'privileged');
  perform makeup_private.lock_cases(a.tenant_id, array[v_id]);
  select * into v_c from public.makeup_cases c where c.id = v_id;
  perform makeup_private.check_revision(p_rev, v_c.revision);
  if v_c.lifecycle = 'closed' or v_c.eligibility <> 'approved' then
    perform makeup_private.fail('conflict', '승인된 진행 중인 보강 건만 면제할 수 있습니다');
  end if;
  if v_reason is null then perform makeup_private.fail('invalid', '면제 사유를 적어 주세요'); end if;
  -- 살아 있는 약속이 있으면 먼저 취소·검토한다(같은 잠금 안에서 다시 검사 — 연쇄 취소는 하지 않는다).
  if v_c.committed_minutes > 0 then
    perform makeup_private.fail('live_commitments', '잡혀 있는 보강 일정이 있습니다 — 일정을 먼저 취소하거나 검토를 마친 뒤 다시 시도해 주세요',
      jsonb_build_object('commitments', makeup_private.live_commitments(v_id)));
  end if;
  if v_minutes is null or v_minutes < 1 or v_minutes > v_c.outstanding_minutes then
    perform makeup_private.fail('invalid', '면제할 분량은 1분 이상, 남은 분량 이하여야 합니다',
      jsonb_build_object('outstanding', v_c.outstanding_minutes));
  end if;
  insert into public.makeup_adjustments (tenant_id, case_id, kind, minutes, reason, policy_version_id, decided_by, effect_key)
    values (a.tenant_id, v_id, 'waiver', v_minutes, v_reason, v_c.policy_version_id, a.user_id, 'adj:' || p_cmd::text);
  perform makeup_private.recompute_case(v_id);
  perform makeup_private.log_event(a.tenant_id, 'case', v_id, 'waived', a.user_id, p_cmd, v_id, null, v_reason,
    jsonb_build_object('minutes', v_minutes));
  perform makeup_private.try_close(a, p_cmd, v_id);
  perform makeup_private.audit(a, 'waive', '보강 면제', jsonb_build_object('command_id', p_cmd, 'case_id', v_id, 'minutes', v_minutes));
  select * into v_c from public.makeup_cases c where c.id = v_id;
  return makeup_private.result('waive', v_id, v_c.revision, 'adj:' || p_cmd::text, array[v_id],
    jsonb_build_object('lifecycle', v_c.lifecycle, 'closure_reason', v_c.closure_reason));
end;
$$;

create or replace function makeup_private.cmd_adjust(a makeup_private.actor_ctx, p_cmd uuid, p jsonb, p_rev integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid := makeup_private.p_uuid(p, 'case_id');
  v_delta integer := makeup_private.p_int(p, 'minutes');
  v_due date := makeup_private.p_date(p, 'due_date');
  v_reason text := makeup_private.p_text(p, 'reason');
  v_c public.makeup_cases%rowtype;
  v_after integer;
begin
  perform makeup_private.require_level(a, 'privileged');
  perform makeup_private.lock_cases(a.tenant_id, array[v_id]);
  select * into v_c from public.makeup_cases c where c.id = v_id;
  perform makeup_private.check_revision(p_rev, v_c.revision);
  if v_c.lifecycle = 'closed' or v_c.eligibility <> 'approved' then
    perform makeup_private.fail('conflict', '승인된 진행 중인 보강 건만 조정할 수 있습니다');
  end if;
  if v_reason is null then perform makeup_private.fail('invalid', '조정 사유를 적어 주세요'); end if;
  if (v_delta is null or v_delta = 0) and not (p ? 'due_date') then
    perform makeup_private.fail('invalid', '바꿀 분량이나 기한을 넣어 주세요');
  end if;
  if v_delta is not null and v_delta <> 0 then
    v_after := v_c.outstanding_minutes + v_delta;
    if v_after < v_c.committed_minutes then
      perform makeup_private.fail('live_commitments', '잡혀 있는 일정보다 적게 줄일 수 없습니다 — 일정을 먼저 취소해 주세요',
        jsonb_build_object('commitments', makeup_private.live_commitments(v_id)));
    end if;
    if v_after < 1 or v_c.target_minutes + v_c.adjusted_minutes + v_delta > 6000 then
      perform makeup_private.fail('invalid', '남은 분량을 0으로 만들 때는 면제를 사용해 주세요 — 조정 뒤 분량을 확인해 주세요');
    end if;
    insert into public.makeup_adjustments (tenant_id, case_id, kind, minutes, reason, policy_version_id, decided_by, effect_key)
      values (a.tenant_id, v_id, 'quantity', v_delta, v_reason, v_c.policy_version_id, a.user_id, 'adj:' || p_cmd::text);
    perform makeup_private.recompute_case(v_id);
    perform makeup_private.log_event(a.tenant_id, 'case', v_id, 'quantity_adjusted', a.user_id, p_cmd, v_id, null,
      v_reason, jsonb_build_object('minutes', v_delta));
  end if;
  if p ? 'due_date' and v_due is distinct from v_c.due_date then
    insert into public.makeup_adjustments (tenant_id, case_id, kind, due_date_from, due_date_to, reason, policy_version_id,
        decided_by, effect_key)
      values (a.tenant_id, v_id, 'due_date', v_c.due_date, v_due, v_reason, v_c.policy_version_id, a.user_id, 'due:' || p_cmd::text);
    update public.makeup_cases c set due_date = v_due where c.id = v_id;
    perform makeup_private.log_event(a.tenant_id, 'case', v_id, 'due_date_changed', a.user_id, p_cmd, v_id, null,
      v_reason, jsonb_build_object('from', v_c.due_date, 'to', v_due));
  end if;
  perform makeup_private.audit(a, 'adjust', '보강 조정', jsonb_build_object('command_id', p_cmd, 'case_id', v_id));
  select * into v_c from public.makeup_cases c where c.id = v_id;
  return makeup_private.result('adjust', v_id, v_c.revision, 'adj:' || p_cmd::text, array[v_id]);
end;
$$;

revoke all on all functions in schema makeup_private from public, anon, authenticated;
