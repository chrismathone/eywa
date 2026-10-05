-- 0346f — 명령: 실시 제출(submit) · 관리자 검토(verify — 인정/반려) + 자동 종결 판정
--
-- 출석·제출만으로는 의무가 줄지 않는다. **검토(verify)** 가 케이스별 인정량을 정한다.
--   · 인정은 배정 단위로 한 번: 같은 실시를 다른 요청으로 다시 검토해도 두 번 들어가지 않는다
--     (실시 상태 잠금 + 안정 효과 키 유니크).
--   · 인정량 차감과 점유 전환은 한 트랜잭션이다. 검토를 마치면 그 참여의 **남은 배정은 자동 해제**된다
--     (120분 예약 중 60분 인정이면 O=60·C=0·R=60 — 별도 해제 클릭이 필요 없다).
--   · 한 참여가 여러 케이스에 걸려 있으면 케이스별로 얼마를 인정했는지 따로 남는다. 인정 합은 실제 지도한
--     분량을 넘지 못한다.
--   · 실제로 가르친 강사는 자기 기록을 검토할 수 없다(대리입력으로도 우회되지 않는다 — 비교 대상은 실제 강사).
--     첫 출시에서는 정책 값과 무관하게 항상 거절한다.
--   · 그 참여에 종결을 막는 대사(시수 차이·시수 확인·출결 불일치·근거 삭제)가 열려 있으면 검토를 거절한다.
--     검토 직전에 출결 효과를 지금 값으로 다시 확인한다(0345e) — 그사이 출결이 바뀌었으면 여기서 드러난다.
-- 자동 종결: 남은 의무 0 · 점유 0 · 미결 항목 없음일 때만 닫는다(전량 실시 completed / 면제 섞임 completed_with_waiver).
-- 🔴 검토는 출결·시수·급여·청구를 쓰지 않는다.
-- 멱등: create or replace.

create or replace function makeup_private.try_close(a makeup_private.actor_ctx, p_cmd uuid, p_case uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_c public.makeup_cases%rowtype;
  v_b jsonb;
begin
  select * into v_c from public.makeup_cases c where c.id = p_case;
  if v_c.lifecycle <> 'open' or v_c.eligibility <> 'approved' or v_c.outstanding_minutes <> 0 or v_c.committed_minutes <> 0 then
    return;
  end if;
  v_b := makeup_private.close_blockers(a.tenant_id, p_case);
  if (v_b ->> 'projections')::integer > 0 or (v_b ->> 'reconciliation')::integer > 0 then return; end if;
  update public.makeup_cases c
     set lifecycle = 'closed', closed_at = now(),
         closure_reason = case when c.recognized_minutes = 0 then 'waived'
                               when c.waived_minutes > 0 then 'completed_with_waiver' else 'completed' end
   where c.id = p_case returning * into v_c;
  perform makeup_private.log_event(a.tenant_id, 'case', p_case, 'closed', a.user_id, p_cmd, p_case, null, null,
    jsonb_build_object('closure_reason', v_c.closure_reason, 'automatic', true,
      'recognized_minutes', v_c.recognized_minutes, 'waived_minutes', v_c.waived_minutes));
end;
$$;

create or replace function makeup_private.cmd_submit(a makeup_private.actor_ctx, p_cmd uuid, p jsonb, p_rev integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid := makeup_private.p_uuid(p, 'participant_id');
  v_report uuid := makeup_private.p_uuid(p, 'report_id');
  v_summary text := left(makeup_private.p_text(p, 'learning_summary'), 2000);
  v_p public.makeup_participants%rowtype;
  v_s public.makeup_sessions%rowtype;
  v_f public.makeup_fulfillments%rowtype;
  v_cases uuid[];
begin
  perform makeup_private.require_level(a, 'write');
  if v_id is null then
    select f.participant_id into v_id from public.makeup_fulfillments f
     where f.id = makeup_private.p_uuid(p, 'fulfillment_id') and f.tenant_id = a.tenant_id;
  end if;
  select * into v_p from public.makeup_participants x where x.id = v_id and x.tenant_id = a.tenant_id;
  if not found then perform makeup_private.fail('not_found', '보강 일정을 찾을 수 없습니다'); end if;
  select * into v_s from public.makeup_sessions s where s.id = v_p.session_id;
  if not a.wide and v_s.teacher_id is distinct from a.user_id then
    perform makeup_private.fail('forbidden', '본인이 맡은 보강의 기록만 제출할 수 있습니다');
  end if;
  select array_agg(al.case_id order by al.case_id) into v_cases from public.makeup_allocations al where al.participant_id = v_id;
  perform makeup_private.lock_cases(a.tenant_id, coalesce(v_cases, '{}'::uuid[]));
  select * into v_p from public.makeup_participants x where x.id = v_id for update;
  select * into v_f from public.makeup_fulfillments f where f.participant_id = v_id and f.state <> 'reversed' for update;
  if v_p.status not in ('present', 'partial') or v_f.id is null then
    perform makeup_private.fail('conflict', '참여를 먼저 기록해 주세요 — 온 학생의 보강만 제출할 수 있습니다');
  end if;
  perform makeup_private.check_revision(p_rev, v_f.revision, false);
  if v_f.state not in ('draft', 'returned') then
    perform makeup_private.fail('conflict', '이미 제출했거나 검토를 마친 기록입니다');
  end if;
  v_report := coalesce(v_report, v_f.report_id);
  perform makeup_private.assert_report(a.tenant_id, v_report, v_p, v_s.teacher_id);
  if v_report is null and coalesce(v_summary, v_f.learning_summary) is null then
    perform makeup_private.fail('invalid', '수업 보고서를 연결하거나 지도한 내용을 적어 주세요');
  end if;
  update public.makeup_fulfillments f
     set state = 'submitted', report_id = v_report, learning_summary = coalesce(v_summary, f.learning_summary),
         evidence_kind = case when v_report is not null then 'report' else f.evidence_kind end,
         homework = coalesce(left(makeup_private.p_text(p, 'homework'), 1000), f.homework),
         submitted_by = a.user_id, submitted_at = now(), return_reason = null
   where f.id = v_f.id returning * into v_f;
  perform makeup_private.log_event(a.tenant_id, 'fulfillment', v_f.id, 'fulfillment_submitted', a.user_id, p_cmd,
    v_cases[1], v_s.id, null, jsonb_build_object('participant_id', v_id, 'report_id', v_report,
      'actual_teacher_id', v_f.actual_teacher_id, 'case_ids', to_jsonb(v_cases)));
  return makeup_private.result('submit', v_f.id, v_f.revision, v_f.effect_key, coalesce(v_cases, '{}'::uuid[]),
    jsonb_build_object('participant_id', v_id, 'session_id', v_s.id, 'fulfillment_id', v_f.id));
end;
$$;

create or replace function makeup_private.cmd_verify(a makeup_private.actor_ctx, p_cmd uuid, p jsonb, p_rev integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid := makeup_private.p_uuid(p, 'fulfillment_id');
  v_recs jsonb := case when jsonb_typeof(p -> 'recognitions') = 'array' then p -> 'recognitions' else '[]'::jsonb end;
  v_f public.makeup_fulfillments%rowtype;
  v_p public.makeup_participants%rowtype;
  v_cases uuid[];
  v_r jsonb;
  v_al public.makeup_allocations%rowtype;
  v_c public.makeup_cases%rowtype;
  v_m integer;
  v_extra integer;
  v_case uuid;
begin
  perform makeup_private.require_level(a, 'privileged');
  select * into v_f from public.makeup_fulfillments f where f.id = v_id and f.tenant_id = a.tenant_id;
  if not found then perform makeup_private.fail('not_found', '실시 기록을 찾을 수 없습니다'); end if;
  select array_agg(al.case_id order by al.case_id) into v_cases
    from public.makeup_allocations al where al.participant_id = v_f.participant_id;
  perform makeup_private.lock_cases(a.tenant_id, coalesce(v_cases, '{}'::uuid[]));
  select * into v_p from public.makeup_participants x where x.id = v_f.participant_id for update;
  select * into v_f from public.makeup_fulfillments f where f.id = v_id for update;
  perform makeup_private.check_revision(p_rev, v_f.revision);
  if v_f.state <> 'submitted' then
    perform makeup_private.fail('conflict', case when v_f.state = 'verified' then '이미 검토를 마친 기록입니다'
      else '제출된 기록만 검토할 수 있습니다' end);
  end if;
  if a.user_id = v_f.actual_teacher_id then
    perform makeup_private.fail('forbidden', '본인이 가르친 보강은 다른 관리자가 검토해야 합니다');
  end if;
  if makeup_private.p_text(p, 'status') = 'returned' then
    if makeup_private.p_text(p, 'reason') is null then perform makeup_private.fail('invalid', '보완할 내용을 적어 주세요'); end if;
    update public.makeup_fulfillments f set state = 'returned', return_reason = left(makeup_private.p_text(p, 'reason'), 500)
     where f.id = v_id returning * into v_f;
    perform makeup_private.log_event(a.tenant_id, 'fulfillment', v_id, 'fulfillment_returned', a.user_id, p_cmd, v_cases[1],
      v_p.session_id, makeup_private.p_text(p, 'reason'), jsonb_build_object('case_ids', to_jsonb(v_cases)));
    return makeup_private.result('verify', v_id, v_f.revision, v_f.effect_key, coalesce(v_cases, '{}'::uuid[]),
      jsonb_build_object('fulfillment_id', v_id, 'participant_id', v_p.id, 'state', 'returned'));
  end if;
  perform makeup_private.sync_attendance_effect(a.tenant_id, v_p.id, a.user_id, true);
  if exists (select 1 from public.makeup_reconciliation r
              where r.tenant_id = a.tenant_id and r.participant_id = v_p.id and r.state = 'open' and r.blocks_close) then
    perform makeup_private.fail('conflict', '이 참여에 확인이 끝나지 않은 항목이 있습니다 — 시수·출결 확인을 먼저 처리한 뒤 검토해 주세요',
      jsonb_build_object('reason', 'open_reconciliation'));
  end if;
  if (p -> 'release_remainder') = 'false'::jsonb then
    perform makeup_private.fail('invalid', '검토를 마치면 남은 배정은 자동으로 풀립니다 — 남은 분량은 새 일정으로 잡아 주세요');
  end if;
  -- 0분으로 적은 건은 "인정 없음"이다(그 배정은 아래에서 전량 해제된다).
  v_recs := coalesce((select jsonb_agg(x) from jsonb_array_elements(v_recs) x where makeup_private.p_int(x, 'minutes') is distinct from 0), '[]'::jsonb);
  if exists (select 1 from jsonb_array_elements(v_recs) x
                 where makeup_private.p_uuid(x, 'case_id') is null or coalesce(makeup_private.p_int(x, 'minutes'), 0) not between 1 and 600)
     or (select count(*) <> count(distinct x ->> 'case_id') from jsonb_array_elements(v_recs) x)
     or (select coalesce(sum(makeup_private.p_int(x, 'minutes')), 0) from jsonb_array_elements(v_recs) x) > coalesce(v_p.actual_minutes, 0) then
    perform makeup_private.fail('invalid', '보강 건별 인정 분량을 확인해 주세요 — 합계는 실제 지도한 분량을 넘을 수 없습니다');
  end if;
  for v_r in select x from jsonb_array_elements(v_recs) x order by x ->> 'case_id' loop
    v_m := makeup_private.p_int(v_r, 'minutes');
    select * into v_al from public.makeup_allocations al
     where al.participant_id = v_p.id and al.case_id = makeup_private.p_uuid(v_r, 'case_id') for update;
    if not found then perform makeup_private.fail('invalid', '이 참여에 배정되지 않은 보강 건입니다'); end if;
    select * into v_c from public.makeup_cases c where c.id = v_al.case_id;
    -- 반전 뒤 다시 검토하는 경우: 풀려 있던 같은 배정을 예약 가능량 안에서 되잡는다.
    v_extra := greatest(v_m - (v_al.allocated_minutes - v_al.recognized_minutes - v_al.released_minutes), 0);
    if v_extra > v_al.released_minutes or v_extra > v_c.outstanding_minutes - v_c.committed_minutes then
      perform makeup_private.fail('conflict', '배정한 분량이나 남은 분량보다 많이 인정할 수 없습니다',
        jsonb_build_object('case_id', v_al.case_id));
    end if;
    update public.makeup_allocations al
       set released_minutes = al.released_minutes - v_extra, recognized_minutes = al.recognized_minutes + v_m
     where al.id = v_al.id;
    insert into public.makeup_recognitions (tenant_id, fulfillment_id, allocation_id, case_id, participant_id, minutes,
        effect_key, decided_by)
      values (a.tenant_id, v_id, v_al.id, v_al.case_id, v_p.id, v_m, 'rec:' || v_id::text || ':' || v_al.id::text, a.user_id);
  end loop;
  update public.makeup_allocations al
     set released_minutes = al.allocated_minutes - al.recognized_minutes, release_reason = 'partial_verify'
   where al.participant_id = v_p.id and al.allocated_minutes - al.recognized_minutes - al.released_minutes > 0;
  update public.makeup_fulfillments f set state = 'verified', verified_by = a.user_id, verified_at = now()
   where f.id = v_id returning * into v_f;
  foreach v_case in array coalesce(v_cases, '{}'::uuid[]) loop
    perform makeup_private.recompute_case(v_case);
    perform makeup_private.log_event(a.tenant_id, 'fulfillment', v_id, 'recognized', a.user_id, p_cmd, v_case, v_p.session_id,
      makeup_private.p_text(p, 'reason'), jsonb_build_object('participant_id', v_p.id, 'actual_minutes', v_p.actual_minutes,
        'minutes', (select makeup_private.p_int(x, 'minutes') from jsonb_array_elements(v_recs) x
                     where makeup_private.p_uuid(x, 'case_id') = v_case)));
    perform makeup_private.try_close(a, p_cmd, v_case);
  end loop;
  perform makeup_private.audit(a, 'verify', '보강 검토', jsonb_build_object('command_id', p_cmd, 'fulfillment_id', v_id));
  return makeup_private.result('verify', v_id, v_f.revision, v_f.effect_key, coalesce(v_cases, '{}'::uuid[]),
    jsonb_build_object('fulfillment_id', v_id, 'participant_id', v_p.id, 'session_id', v_p.session_id, 'state', 'verified'));
end;
$$;

revoke all on all functions in schema makeup_private from public, anon, authenticated;
