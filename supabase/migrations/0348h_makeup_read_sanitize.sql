-- 0348h — 읽기 RPC의 출력 정리: 대사·반영 작업·이벤트를 **행위자 범위만** 남겨 내보낸다
--
-- 잠금·종결 차단은 "닿는 케이스 전부"(0344c)로 판정하지만, 화면으로 나가는 값은 달라야 한다. 한 회차에 여러 학생이 있고
-- 한 참여가 여러 건에 걸리므로, 행을 통째로 내보내면 범위 밖 건·참여의 번호가 같이 샌다. 그래서 읽기 RPC(상세·대사 목록·
-- 이력)는 표의 행을 그대로 내보내지 않고 이 파일의 함수를 거친다:
--   · case_id · case_ids · participant_id · participant_ids — 행위자 범위 안의 것만(0344c visible_*). 범위 밖은 지운다.
--   · detail · payload · 이벤트 data 안의 같은 이름 키도 같은 규칙으로 정리한다(scrub_json). 지점 전체 읽기 권한은 그대로 본다.
--   · 묶음 키(dedupe_key)·효과 키(effect_key)는 번호를 품고 있다 — 범위 밖 번호가 섞이면 내보내지 않는다.
--   · 🔴 수납 정보: 수납 확인 대사(billing_review)의 detail(수납 기준·예상 소비·원수업일)과 다른 대사의 `quantity_basis`는
--     **수납 읽기 권한**(0158a `auth_billing_can_read`)이 있어야 나간다. 없으면 "확인할 항목이 있다"는 표시만 나간다
--     (kind·state·blocks_close + restricted: true). 표 자체는 RLS(정책 없음)와 권한 회수로 직접 읽히지 않는다.
-- 멱등: create or replace.

create or replace function makeup_private.scrub_json(a makeup_private.actor_ctx, p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v jsonb := coalesce(p, '{}'::jsonb);
begin
  if jsonb_typeof(v) <> 'object' or makeup_private.can_read_all(a) then return v; end if;
  if jsonb_typeof(v -> 'case_ids') = 'array' then
    v := jsonb_set(v, '{case_ids}', to_jsonb(makeup_private.visible_case_ids(a,
      array(select x::uuid from jsonb_array_elements_text(v -> 'case_ids') x where x ~ '^[0-9a-fA-F-]{36}$'))));
  end if;
  if jsonb_typeof(v -> 'participant_ids') = 'array' then
    v := jsonb_set(v, '{participant_ids}', to_jsonb(makeup_private.visible_participant_ids(a,
      array(select x::uuid from jsonb_array_elements_text(v -> 'participant_ids') x where x ~ '^[0-9a-fA-F-]{36}$'))));
  end if;
  if v ->> 'case_id' ~ '^[0-9a-fA-F-]{36}$' and not makeup_private.in_scope(a, (v ->> 'case_id')::uuid) then v := v - 'case_id'; end if;
  if v ->> 'participant_id' ~ '^[0-9a-fA-F-]{36}$' and not makeup_private.participant_in_scope(a, (v ->> 'participant_id')::uuid) then
    v := v - 'participant_id';
  end if;
  return v;
end;
$$;

create or replace function makeup_private.recon_public(a makeup_private.actor_ctx, r public.makeup_reconciliation) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_all boolean := makeup_private.can_read_all(a);
  v_money boolean := makeup_private.can_read_billing();
  v_cases uuid[] := makeup_private.visible_case_ids(a, makeup_private.recon_case_ids(r));
  v_part uuid := case when r.participant_id is not null and (v_all or makeup_private.participant_in_scope(a, r.participant_id)) then r.participant_id end;
  v_base jsonb;
begin
  v_base := jsonb_build_object('id', r.id, 'revision', r.revision, 'kind', r.kind, 'state', r.state, 'blocks_close', r.blocks_close,
    'case_id', case when r.case_id = any (v_cases) then r.case_id end, 'case_ids', to_jsonb(v_cases),
    'created_at', r.created_at, 'updated_at', r.updated_at, 'resolved_at', r.resolved_at);
  if r.kind = 'billing_review' and not v_money then
    -- 수납 읽기 권한이 없는 계정: 항목이 있다는 사실만.
    return v_base || jsonb_build_object('restricted', true, 'detail', '{}'::jsonb, 'participant_id', null, 'session_id', null,
      'attendance_record_id', null, 'legacy_id', null, 'resolved_by', null, 'resolution_note', null,
      'summary', '수납 담당자가 확인할 항목이 있습니다');
  end if;
  return v_base || jsonb_build_object('restricted', false, 'participant_id', v_part, 'session_id', r.session_id,
    'attendance_record_id', r.attendance_record_id, 'legacy_id', r.legacy_id,
    'detail', makeup_private.scrub_json(a, case when v_money then r.detail else r.detail - 'quantity_basis' end),
    'resolved_by', r.resolved_by, 'resolution_note', r.resolution_note,
    'summary', makeup_private.recon_summary(r.kind, r.detail),
    'dedupe_key', case when v_all then r.dedupe_key end);
end;
$$;

create or replace function makeup_private.job_public(a makeup_private.actor_ctx, j public.makeup_projection_jobs) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_all boolean := makeup_private.can_read_all(a);
  v_cases uuid[] := makeup_private.visible_case_ids(a, makeup_private.job_case_ids(j));
  v_parts uuid[] := case when v_all then j.participant_ids else makeup_private.visible_participant_ids(a, j.participant_ids) end;
  v_part uuid := case when j.participant_id is not null and (v_all or makeup_private.participant_in_scope(a, j.participant_id)) then j.participant_id end;
  -- 효과 키는 참여·예약 번호를 품는다 — 그 작업의 참여가 전부 범위 안일 때만 내보낸다.
  v_whole boolean := v_all or (cardinality(v_parts) = cardinality(j.participant_ids) and (j.participant_id is null or v_part is not null)
                               and cardinality(v_cases) = cardinality(makeup_private.job_case_ids(j)));
begin
  return jsonb_build_object('id', j.id, 'revision', j.revision, 'kind', j.kind, 'state', j.state,
    'effect_key', case when v_whole then j.effect_key end,
    'case_id', case when j.case_id = any (v_cases) then j.case_id end, 'case_ids', to_jsonb(v_cases),
    'participant_id', v_part, 'participant_ids', to_jsonb(v_parts),
    'payload', case when v_whole then makeup_private.scrub_json(a, j.payload)
                    else jsonb_build_object('restricted', true) end,
    'attempts', j.attempts, 'last_error', j.last_error, 'created_at', j.created_at, 'updated_at', j.updated_at);
end;
$$;

revoke all on all functions in schema makeup_private from public, anon, authenticated;
