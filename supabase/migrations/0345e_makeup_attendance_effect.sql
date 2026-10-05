-- 0345e — 출결 효과의 검증·반영(한 helper)  (증거 조회·노쇼 되돌리기·케이스 잠금은 0345f)
--
-- 반영 작업(att:<참여>)은 "출결 쪽에서 관측된 것이 원장과 맞는가"다. **사람의 사유나 API 성공만으로 done이 되지 않는다.**
--   attendance_snapshot — 지금의 증거: 그 칸(학생·출결 반·날짜)에서 대조할 유효 행(id·상태·시수·귀속 강사·교시) + 참여 상태·출결 반·회차 강사.
--     대조할 행은 0345c day_primary가 정한다 — **행이 들어온 순서와 무관**하다(교시마다 최신 정정 한 줄 중에서 고른다).
--     그날 유효 칸이 둘 이상이면 다른 칸(상태·담당·시수)도 증거에 넣는다 → 어느 칸이 바뀌어도 done·승인을 다시 판정한다.
--   verify_raw — 지금 저장된 값으로만 판정한다(쓰지 않는다):
--     대조할 유효 행 → 참여 상태와 일치 → 귀속 강사·교시·그날의 다른 칸·정규 강사(0345d) → 실제 시수 = 서버 예상 시수.
--     ok · pending(자료 없음/참여 전) · 불일치 코드 가운데 하나.
--   verify_attendance_effect — verify_raw + **승인된 차이**. 원장·관리자가 승인(0346k)할 때 그 순간의 증거 스냅샷과 불일치 코드를
--     함께 적는다. 지금 증거가 그 스냅샷과 **정확히 같고** 불일치 코드도 같을 때만 ok = true · code = accepted_manual_units 를
--     돌려준다. 출결 행·상태·시수·귀속 강사·출결 반·참여 상태 가운데 하나라도 바뀌었으면 옛 승인은 새 증거를 덮지 못한다
--     (다시 불일치 → 같은 대사가 다시 열린다).
--   sync_attendance_effect — 위 판정을 반영한다. 참여 입력·작업 재확인·출결 관측 트리거·대사 실행이 **같은 함수**를 지난다.
--     · 먼저 그 참여가 걸린 케이스 행을 잠근다 — 종결(같은 행 잠금 안에서 미결 항목을 센다)과 줄을 선다. 그래서 "종결이 세는
--       순간에 막 생기던 항목"이 빠지지 않는다: 관측이 먼저면 종결이 막히고, 종결이 먼저면 닫힌 건에 항목이 보이게 남는다.
--     · ok → (명령 안에서만) 참여·실시 기록에 그 출결 행을 연결, 작업 done, 그 참여의 시수·관측 대사를 닫는다.
--       pending → 그대로. 불일치 → 작업 failed + 대사(units_mismatch · units_review · attendance_observed — 종결·검토 차단).
--     · 이미 done인 작업은 **증거가 그대로면** 다시 판정하지 않는다(담임 변경 같은 주변 사정이 지난 반영을 뒤집지 않는다).
--       증거가 바뀌면 닫힌 건이어도 다시 판정해 항목을 연다. 시수·출결은 어느 경우에도 고치지 않는다.
-- 멱등: create or replace.

create or replace function makeup_private.attendance_snapshot(p_tenant uuid, p_part uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('participation', p.status, 'anchor_class_id', p.anchor_class_id, 'session_teacher_id', s.teacher_id,
    'attendance_record_id', ar.id, 'status', ar.status::text, 'session_units', ar.session_units,
    'taught_by', to_jsonb(ar) -> 'taught_by', 'slot_start', ar.slot_start)
    || coalesce((select jsonb_build_object('day_cells', jsonb_agg(jsonb_build_array(c.id, c.slot_start, c.status, to_jsonb(c) -> 'taught_by',
                                                         c.session_units) order by c.slot_start nulls first))
                   from makeup_private.day_cells(p_tenant, p.student_id, p.anchor_class_id, p.session_date) c
                 having count(*) > 1), '{}'::jsonb)
  from public.makeup_participants p
  join public.makeup_sessions s on s.id = p.session_id
  left join public.attendance_records ar on ar.id = makeup_private.day_primary(p_tenant, p.id)
  where p.id = p_part and p.tenant_id = p_tenant
$$;

create or replace function makeup_private.verify_raw(p_tenant uuid, p_part uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_p public.makeup_participants%rowtype;
  v_s public.makeup_sessions%rowtype;
  v_att uuid; v_status text; v_actual numeric;
  v_issue text;
  v_u record;
begin
  select * into v_p from public.makeup_participants x where x.id = p_part and x.tenant_id = p_tenant;
  select * into v_s from public.makeup_sessions s where s.id = v_p.session_id;
  if v_p.id is null or v_p.status = 'cancelled' then return jsonb_build_object('ok', false, 'code', 'participation_cancelled'); end if;
  select ar.id, ar.status::text, coalesce(ar.session_units, 1) into v_att, v_status, v_actual
    from public.attendance_records ar where ar.id = makeup_private.day_primary(p_tenant, p_part);
  if v_att is null then
    return jsonb_build_object('ok', v_p.status = 'no_show', 'pending', v_p.status <> 'no_show', 'code', 'attendance_missing');
  end if;
  if v_p.status = 'unknown' then
    return jsonb_build_object('ok', false, 'pending', true, 'code', 'participation_missing', 'attendance_record_id', v_att);
  end if;
  select * into v_u from makeup_private.expected_units(p_tenant, v_p, v_s.start_time, v_s.end_time, v_p.status);
  if v_p.status = 'no_show' then
    -- 안 온 것으로 기록했다: 그 칸이 시수 상태가 아니거나, 정규 수업분만(예상 정규 시수) 남아 있어야 맞다.
    if v_status not in ('present', 'late', 'early_leave', 'makeup') or (v_u.o_regular > 0 and v_actual = v_u.o_total) then
      return jsonb_build_object('ok', true, 'attendance_record_id', v_att, 'actual_units', v_actual, 'expected_units', v_u.o_total);
    end if;
    return jsonb_build_object('ok', false, 'code', 'no_show_with_attendance', 'attendance_record_id', v_att,
      'attendance_status', v_status, 'actual_units', v_actual, 'expected_units', v_u.o_total);
  end if;
  v_issue := makeup_private.attendance_issue(p_tenant, v_att, v_p, v_s.teacher_id, v_s.start_time, v_s.end_time, v_p.status);
  if v_issue is not null then
    return jsonb_build_object('ok', false, 'code', v_issue, 'attendance_record_id', v_att, 'attendance_status', v_status);
  end if;
  if v_u.o_regular is null then
    -- 자동 시수를 쓰지 않는 지점·과목: 시수는 대조하지 않는다(귀속·상태·최신 행 검증까지만).
    return jsonb_build_object('ok', true, 'attendance_record_id', v_att, 'actual_units', v_actual, 'units_checked', false);
  end if;
  if v_u.o_total is null or v_actual <> v_u.o_total then
    return jsonb_build_object('ok', false, 'code', case when v_u.o_total is null then 'units_unknown' else 'units_mismatch' end,
      'attendance_record_id', v_att, 'actual_units', v_actual, 'expected_units', v_u.o_total,
      'expected_makeup_units', v_u.o_makeup, 'expected_regular_units', v_u.o_regular);
  end if;
  return jsonb_build_object('ok', true, 'attendance_record_id', v_att, 'actual_units', v_actual, 'expected_units', v_u.o_total,
    'expected_makeup_units', v_u.o_makeup, 'expected_regular_units', v_u.o_regular);
end;
$$;

create or replace function makeup_private.verify_attendance_effect(p_tenant uuid, p_part uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v jsonb := makeup_private.verify_raw(p_tenant, p_part);
  v_d jsonb;
begin
  if (v ->> 'ok')::boolean or coalesce((v ->> 'pending')::boolean, false) then return v; end if;
  select r.detail into v_d from public.makeup_reconciliation r
   where r.tenant_id = p_tenant and r.participant_id = p_part and r.state = 'resolved'
     and r.kind in ('units_mismatch', 'units_review', 'attendance_observed')
     and coalesce((r.detail ->> 'accepted')::boolean, false)
     and r.detail ->> 'code' is not distinct from v ->> 'code'
     and r.detail -> 'accepted_snapshot' = makeup_private.attendance_snapshot(p_tenant, p_part)
   order by r.updated_at desc limit 1;
  if v_d is null then return v; end if;
  return v || jsonb_build_object('ok', true, 'code', 'accepted_manual_units', 'accepted', true, 'accepted_code', v ->> 'code',
    'accepted_by', v_d -> 'accepted_by', 'accepted_at', v_d -> 'accepted_at');
end;
$$;

-- p_link = 명령 안(참여·실시 기록에 연결까지 한다). 트리거·대사 실행은 false(관측·대사만 남긴다).
create or replace function makeup_private.sync_attendance_effect(
  p_tenant uuid, p_part uuid, p_actor uuid, p_link boolean, p_claim jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v jsonb;
  v_p public.makeup_participants%rowtype;
  v_cases uuid[];
  v_att uuid;
  v_state text;
  v_kind text;
  v_snap jsonb;
  v_job public.makeup_projection_jobs%rowtype;
begin
  select coalesce(array_agg(al.case_id order by al.case_id), '{}'::uuid[]) into v_cases
    from public.makeup_allocations al where al.participant_id = p_part;
  perform makeup_private.lock_touched_cases(p_tenant, v_cases);
  select * into v_p from public.makeup_participants x where x.id = p_part;
  v_snap := makeup_private.attendance_snapshot(p_tenant, p_part);
  select * into v_job from public.makeup_projection_jobs j where j.tenant_id = p_tenant and j.effect_key = 'att:' || p_part::text;
  if v_job.state = 'done' and v_job.payload -> 'snapshot' = v_snap
     and (not p_link or (v_p.attendance_record_id is not distinct from (v_snap ->> 'attendance_record_id')::uuid
          and v_p.expected_makeup_units is not distinct from (v_job.payload -> 'verification' ->> 'expected_makeup_units')::numeric)) then
    -- 증거가 그대로인 done: 다시 판정하지 않는다(아래의 실패 표시 정리만 한다).
    v := v_job.payload -> 'verification';
    v_state := 'done';
    v_job.id := null;
  else
    v := makeup_private.verify_attendance_effect(p_tenant, p_part);
    v_att := (v ->> 'attendance_record_id')::uuid;
  end if;
  if v_state = 'done' then
    null;
  elsif (v ->> 'ok')::boolean then
    if p_link and v_att is not null then
      update public.makeup_participants x
         set attendance_record_id = v_att, expected_makeup_units = (v ->> 'expected_makeup_units')::numeric
       where x.id = p_part and (x.attendance_record_id is distinct from v_att
              or x.expected_makeup_units is distinct from (v ->> 'expected_makeup_units')::numeric);
      update public.makeup_fulfillments f set attendance_record_id = v_att
       where f.participant_id = p_part and f.state in ('draft', 'submitted', 'returned') and f.attendance_record_id is distinct from v_att;
    end if;
    -- 연결까지 끝났을 때만 done. 트리거가 본 경우는 연결이 아직이면 pending으로 둔다(대기는 작업 줄이 말한다).
    v_state := case when v_att is null or p_link or v_p.attendance_record_id = v_att then 'done' else 'pending' end;
    -- 사실이 맞으면 그 참여의 시수·관측 대사는 닫는다(사람이 고친 출결을 다시 확인하라고 붙잡지 않는다).
    update public.makeup_reconciliation r
       set state = 'resolved', resolved_at = now(), resolved_by = p_actor, resolution_note = '출결과 원장이 다시 일치합니다',
           detail = r.detail || '{"auto_resolved": true}'::jsonb
     where r.tenant_id = p_tenant and r.participant_id = p_part and r.state = 'open'
       and r.kind in ('units_mismatch', 'units_review', 'attendance_observed');
  elsif coalesce((v ->> 'pending')::boolean, false) then
    v_state := 'pending';
  else
    v_state := 'failed';
    v_kind := case v ->> 'code' when 'units_mismatch' then 'units_mismatch'
                when 'units_unknown' then 'units_review' when 'no_show_with_attendance' then 'units_review' else 'attendance_observed' end;
    -- 승인된 차이는 위 판정이 이미 ok로 돌려준다. 여기 왔다면 승인이 없거나 승인 뒤 증거가 바뀐 것이다 → (다시) 연다.
    perform makeup_private.open_recon(p_tenant, v_kind, v_kind || ':' || p_part::text, true, v_cases[1], p_part, v_p.session_id, v_att, null,
      (v - 'ok') || jsonb_build_object('participation', v_p.status, 'case_ids', to_jsonb(v_cases),
        'quantity_basis', makeup_private.billing_basis(p_tenant, v_p.student_id, v_p.anchor_class_id, v_p.session_date),
        'client_claim', coalesce(p_claim, '{}'::jsonb)));
  end if;
  if v_att is not null or v_job.id is not null then
    insert into public.makeup_projection_jobs as j (tenant_id, kind, effect_key, case_id, participant_id, case_ids, participant_ids, state, payload, last_error)
      values (p_tenant, 'attendance_effect', 'att:' || p_part::text, v_cases[1], p_part, v_cases, array[p_part], v_state,
        jsonb_build_object('attendance_record_id', v_att, 'verification', v, 'snapshot', v_snap),
        case when v_state = 'done' then null else v ->> 'code' end)
      on conflict (tenant_id, effect_key) do update
        set state = excluded.state, payload = excluded.payload, last_error = excluded.last_error, case_ids = excluded.case_ids,
            attempts = j.attempts + 1
        where (j.state, j.payload, j.last_error) is distinct from (excluded.state, excluded.payload, excluded.last_error);
  end if;
  -- 앱이 남긴 반영 실패 표시(0348f effect_gap)는 서버 검증이 끝까지 맞았을 때만 함께 닫힌다.
  if v_state = 'done' and v_p.status <> 'unknown' then
    update public.makeup_projection_jobs j set state = 'done', last_error = null
     where j.tenant_id = p_tenant and j.kind = 'effect_gap' and j.state <> 'done' and p_part = any (j.participant_ids)
       and not exists (select 1 from public.makeup_projection_jobs o
                        where o.tenant_id = p_tenant and o.kind = 'attendance_effect' and o.state <> 'done'
                          and o.participant_id = any (j.participant_ids));
  end if;
  return jsonb_build_object('projection_state', v_state, 'verification', v);
end;
$$;

revoke all on all functions in schema makeup_private from public, anon, authenticated;
