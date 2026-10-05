-- 0346k — 명령: 대사·반영 작업 해결(resolve_reconciliation)
--
-- 🔴 "확인했다"는 사유만으로 닫지 않는다. 닫히는 길은 사실이 맞을 때와 권한자가 명시적으로 승인할 때뿐이다.
-- 반영 작업(projection_id):
--   · status 생략 또는 'done' = **다시 반영**(0348f reverify_job). 0345e의 같은 helper(출결의 최신 유효 행·참여 상태·귀속 강사·
--     교시·시수)를 지나 맞으면 연결 + done, 어긋나면 failed(사유 코드 + 대사), 자료가 없으면 pending 그대로. 요청이 done을
--     정하지 못한다. 관측 실패 작업은 그 출결 칸을 다시 관측하고, 앱이 남긴 반영 실패 표시도 같은 검증을 지난다.
--   · status 'failed' = 사람이 "반영하지 못함"으로 남긴다(사유 기록). 종결은 계속 막힌다.
--   · 연결이 바뀔 수 있으므로 닿는 케이스를 전부 잠그고(범위·개정 번호 재확인) 수량·종결 조건을 다시 본다.
--   · 응답: {projection_state: pending|done|failed, verification{ok, code, …}}.
-- 대사(reconciliation_id):
--   · 시수·출결 대사(units_mismatch · units_review · attendance_observed): 먼저 지금 값으로 다시 확인한다 — 출결을 정정해
--     일치하면 여기서 닫힌다. 여전히 다르면 원장·관리자의 **명시적 승인**(accept_manual_units: true + 사유)만 닫을 수 있다.
--     승인은 그 순간의 증거 스냅샷(출결 행·상태·시수·귀속 강사·출결 반·참여 상태)과 불일치 코드를 대사 detail과 감사로그에 남긴다.
--     그 뒤 검증은 증거가 스냅샷과 **정확히 같을 때만** ok(accepted_manual_units)를 돌려준다 — 바뀌면 다시 열린다. 시수·출결은 고치지 않는다.
--   · 수납 확인(billing_review)은 수납 읽기 권한까지 있어야 처리한다.
--   · 앵커 반 없음(anchor_missing): 출결·보고서를 세울 반을 골라야 닫힌다.
--   · 원수업 출결 충돌(source_conflict): 원수업 칸이 다시 결석이 되면 관측이 닫는다. 그대로 두고 닫는 것은 원장·관리자의 결정(사유 기록).
--   · 수량 어긋남(quantity_drift): 닫을 때 하위 기록에서 수량을 다시 계산해 맞춘 뒤 닫는다.
--   · 시수·근거·수납·원수업 충돌·수량은 원장·관리자, 그 밖은 지점 전체 운영 권한.
-- 멱등: create or replace.

create or replace function makeup_private.cmd_resolve(a makeup_private.actor_ctx, p_cmd uuid, p jsonb, p_rev integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid := makeup_private.p_uuid(p, 'reconciliation_id');
  v_job_id uuid := makeup_private.p_uuid(p, 'projection_id');
  v_status text := makeup_private.p_text(p, 'status');
  v_note text := coalesce(makeup_private.p_text(p, 'note'), makeup_private.p_text(p, 'reason'));
  v_accept boolean := coalesce((p -> 'accept_manual_units') = 'true'::jsonb, false);
  v_r public.makeup_reconciliation%rowtype;
  v_j public.makeup_projection_jobs%rowtype;
  v_p public.makeup_participants%rowtype;
  v_cases uuid[];
  v_case uuid;
  v_eff jsonb := '{}'::jsonb;
  v_anchor uuid;
begin
  if v_note is null then perform makeup_private.fail('invalid', '확인한 내용을 적어 주세요'); end if;
  if v_job_id is not null then
    perform makeup_private.require_level(a, 'wide');
    select * into v_j from public.makeup_projection_jobs j where j.id = v_job_id and j.tenant_id = a.tenant_id;
    if not found then perform makeup_private.fail('not_found', '반영 작업을 찾을 수 없습니다'); end if;
    -- 닿는 케이스 전부(작업에 적힌 것 + 표시가 가리키는 예약의 지금 연결)를 잠근다 — 연결이 바뀌면 수량·종결을 다시 본다.
    v_cases := array(select unnest(makeup_private.job_case_ids(v_j))
                     union select m.case_id from public.makeup_legacy_maps m
                            where m.tenant_id = a.tenant_id and m.legacy_kind = 'reservation' and m.state = 'active'
                              and m.legacy_id = makeup_private.p_uuid(v_j.payload, 'reservation_id')
                     order by 1);
    perform makeup_private.lock_cases(a.tenant_id, v_cases);
    select * into v_j from public.makeup_projection_jobs j where j.id = v_job_id for update;
    perform makeup_private.check_revision(p_rev, v_j.revision);
    if v_status = 'failed' then
      update public.makeup_projection_jobs j set state = 'failed', attempts = j.attempts + 1, last_error = left(v_note, 1000) where j.id = v_job_id;
    elsif v_status is null or v_status = 'done' then
      v_eff := makeup_private.reverify_job(a.tenant_id, a.user_id, v_job_id, true);
    else
      perform makeup_private.fail('invalid', '처리 결과를 골라 주세요');
    end if;
    select * into v_j from public.makeup_projection_jobs j where j.id = v_job_id;
    foreach v_case in array v_cases loop
      perform makeup_private.recompute_case(v_case);
      perform makeup_private.try_close(a, p_cmd, v_case);
    end loop;
    perform makeup_private.log_event(a.tenant_id, 'projection', v_job_id, 'projection_' || v_j.state, a.user_id, p_cmd,
      v_cases[1], null, v_note, jsonb_build_object('effect_key', v_j.effect_key, 'verification', v_eff -> 'verification', 'case_ids', to_jsonb(v_cases)));
    return makeup_private.result('resolve_reconciliation', v_job_id, v_j.revision, v_j.effect_key, v_cases,
      jsonb_build_object('projection_state', v_j.state, 'verification', v_eff -> 'verification'));
  end if;

  select * into v_r from public.makeup_reconciliation r where r.id = v_id and r.tenant_id = a.tenant_id;
  if not found then perform makeup_private.fail('not_found', '확인 필요 항목을 찾을 수 없습니다'); end if;
  if v_r.kind = 'billing_review' and not makeup_private.can_read_billing() then
    perform makeup_private.fail('forbidden', '수납 확인 항목은 수납을 볼 수 있는 관리자만 처리할 수 있습니다');
  end if;
  perform makeup_private.require_level(a, case when v_r.kind in ('units_review', 'units_mismatch', 'attendance_observed',
    'evidence_removed', 'billing_review', 'quantity_drift', 'source_conflict') then 'privileged' else 'wide' end);
  v_cases := makeup_private.recon_case_ids(v_r);
  perform makeup_private.lock_cases(a.tenant_id, v_cases);
  select * into v_r from public.makeup_reconciliation r where r.id = v_id for update;
  perform makeup_private.check_revision(p_rev, v_r.revision);
  if v_r.state <> 'open' then perform makeup_private.fail('conflict', '이미 처리한 항목입니다'); end if;
  v_status := coalesce(v_status, 'resolved');
  if v_status not in ('resolved', 'dismissed') then perform makeup_private.fail('invalid', '처리 결과를 골라 주세요'); end if;

  if v_r.kind in ('units_mismatch', 'units_review', 'attendance_observed') and v_r.participant_id is not null then
    perform 1 from public.makeup_participants x where x.id = v_r.participant_id for update;
    v_eff := makeup_private.sync_attendance_effect(a.tenant_id, v_r.participant_id, a.user_id, true);
    select * into v_r from public.makeup_reconciliation r where r.id = v_id;
    if v_r.state = 'open' then
      if not v_accept or v_status <> 'resolved' then
        perform makeup_private.fail('conflict', '출결을 정정했거나 차이를 승인할 때만 닫을 수 있습니다 — 차이를 그대로 인정하려면 승인으로 표시해 주세요',
          jsonb_build_object('verification', v_eff -> 'verification'));
      end if;
      -- 승인 = 지금의 증거 스냅샷(출결 행·상태·시수·귀속 강사·출결 반·참여 상태)과 불일치 코드를 함께 적는다. 증거가 바뀌면 무효다.
      update public.makeup_reconciliation r
         set state = 'resolved', resolved_by = a.user_id, resolved_at = now(), resolution_note = left(v_note, 500),
             detail = r.detail || jsonb_build_object('accepted', true, 'accepted_by', a.user_id, 'accepted_at', now(),
               'accepted_snapshot', makeup_private.attendance_snapshot(a.tenant_id, v_r.participant_id))
       where r.id = v_id returning * into v_r;
      perform makeup_private.audit(a, 'accept_units', '시수 차이 승인', jsonb_build_object('command_id', p_cmd,
        'reconciliation_id', v_id, 'kind', v_r.kind, 'detail', v_r.detail));
      -- 같은 검증 helper를 다시 지난다: 승인된 스냅샷과 정확히 같을 때만 ok(accepted_manual_units) + 작업 done.
      v_eff := makeup_private.sync_attendance_effect(a.tenant_id, v_r.participant_id, a.user_id, true);
      if v_eff ->> 'projection_state' <> 'done' then
        perform makeup_private.fail('conflict', '승인하는 사이 출결이 바뀌었습니다 — 새로 고친 뒤 다시 확인해 주세요');
      end if;
      select * into v_r from public.makeup_reconciliation r where r.id = v_id;
    else
      update public.makeup_reconciliation r set resolution_note = left(v_note, 500) where r.id = v_id returning * into v_r;
    end if;
  else
    if v_r.kind = 'anchor_missing' and v_status = 'resolved' then
      select * into v_p from public.makeup_participants x where x.id = v_r.participant_id for update;
      v_anchor := makeup_private.resolve_anchor(a.tenant_id, v_p.student_id, v_p.subject_key, v_p.session_date,
        makeup_private.p_uuid(p, 'anchor_class_id'), null);
      if v_anchor is null then perform makeup_private.fail('invalid', '출결·보고서를 세울 반을 골라 주세요'); end if;
      update public.makeup_participants x set anchor_class_id = v_anchor where x.id = v_p.id;
    end if;
    update public.makeup_reconciliation r
       set state = v_status, resolved_by = a.user_id, resolved_at = now(), resolution_note = left(v_note, 500)
     where r.id = v_id returning * into v_r;
  end if;
  perform makeup_private.log_event(a.tenant_id, 'reconciliation', v_id, 'reconciliation_' || v_r.state, a.user_id, p_cmd,
    v_cases[1], v_r.session_id, v_note, jsonb_build_object('kind', v_r.kind, 'anchor_class_id', v_anchor,
      'accepted', v_r.detail -> 'accepted', 'verification', v_eff -> 'verification', 'case_ids', to_jsonb(v_cases)));
  -- 종결을 막던 항목이 풀렸으면 조건이 찬 케이스는 닫힌다.
  foreach v_case in array v_cases loop
    perform makeup_private.recompute_case(v_case);
    perform makeup_private.try_close(a, p_cmd, v_case);
  end loop;
  return makeup_private.result('resolve_reconciliation', v_id, v_r.revision, 'recon:' || v_r.dedupe_key, v_cases,
    jsonb_build_object('state', v_r.state, 'verification', v_eff -> 'verification'));
end;
$$;

revoke all on all functions in schema makeup_private from public, anon, authenticated;
