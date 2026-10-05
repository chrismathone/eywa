-- 0350e — 명령: 대사 해결(resolve_reconciliation) — 출결 반을 정하면 그 반의 출결을 바로 다시 본다
--
-- 0346k의 cmd_resolve를 바꿔 끼운다. 바뀐 곳은 "출결 반 확인(anchor_missing)" 한 갈래뿐이다.
--   출결 반이 비어 있는 동안에는 그 참여가 대조할 출결 칸이 없어 출결 관측(0349b)이 아무것도 보지 못한다. 반을 정한 뒤에도
--   누가 대사를 실행하기 전까지는 그대로였다. 이제 반을 정하는 같은 명령 안에서 **관측만** 한 번 한다:
--   · 0349b·0349e와 같은 helper·같은 방식(sync_attendance_effect, 연결하지 않는 관측)이다. 참여·실시 기록에 출결을 잇지 않고,
--     출결·시수·보고서를 쓰지 않는다. 취소된 참여는 보지 않는다(관측과 같다).
--   · 그 반에 그날 출결이 없으면 아무것도 만들지 않는다(반영 작업도 대사도 없다 — 종결 조건은 종전 그대로다).
--   · 출결이 있고 원장과 어긋나면 종전 규칙대로 시수·출결 확인 항목이 열린다. 반을 정한 직후에 보이는 것이 맞다.
--   · 결과에 anchor_class_id와 anchor_verification {state: pending|done|failed, ok, code}를 싣는다.
--     🔴 projection_state 칸으로 내보내지 않는다 — 화면이 그 칸의 pending을 "반영 대기" 경고로 읽는데, 아직 오지 않은
--        회차는 출결이 없는 것이 정상이다.
-- 그 밖의 갈래(반영 작업 다시 확인 · 시수/출결 대사 · 수납 확인 · 수량 어긋남 등)는 0346k와 한 글자도 다르지 않다.
-- 🔴 0346k를 손으로 다시 실행했으면 이 파일도 다시 실행한다(뒤에 실행한 정의가 남는다).
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
  v_seen jsonb;
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
    -- 반을 정했으면 그 반의 그날 출결을 한 번 관측한다(연결하지 않는다 — 0349b·0349e와 같은 방식). 취소된 참여는 보지 않는다.
    if v_anchor is not null and v_p.status <> 'cancelled' then
      v_seen := makeup_private.sync_attendance_effect(a.tenant_id, v_p.id, a.user_id, false);
    end if;
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
    jsonb_build_object('state', v_r.state, 'verification', v_eff -> 'verification')
    || case when v_anchor is null then '{}'::jsonb else jsonb_build_object('anchor_class_id', v_anchor,
         'anchor_verification', case when v_seen is null then null else jsonb_build_object(
           'state', v_seen ->> 'projection_state', 'ok', coalesce((v_seen -> 'verification' ->> 'ok')::boolean, false),
           'code', v_seen -> 'verification' ->> 'code') end) end);
end;
$$;

revoke all on all functions in schema makeup_private from public, anon, authenticated;
