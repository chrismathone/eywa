-- 0348f — 반영 실패 기록(public.makeup_note_effect_gap) · 증거 조회(public.makeup_projection_evidence) · 작업 재확인
--
-- 출결 저장 훅(앱)이 "이 출결은 저장했지만 보강 원장에는 반영하지 못했다"를 남기는 문이다. 출결 저장은 이 호출의
-- 성공·실패와 무관하게 이미 끝나 있다 — 이 함수는 **출결·시수·보고서를 쓰지 않는다**.
-- makeup_note_effect_gap(p_gap jsonb) → {queued:true, id, effect_key, kind, state, projection_state, case_ids[]}
--   p_gap: {effect_key(필수), kind(필수 · 소문자 snake — teacher_hold · observation · units_review · participation_failed ·
--          classify_blocked · split_hold · complete_failed · units_write_failed …), participant_id, reservation_id, error}
--   · 행위자 = auth.uid()(사용자 세션). 관리자 클라이언트(service_role)는 실행 권한이 없고 행위자도 없어 거절된다.
--   · 참여나 기존 예약 가운데 하나는 가리켜야 한다(무엇을 다시 확인할지 모르는 표시는 받지 않는다). 범위 밖이면 거절.
--   · (effect_key, kind)에 멱등 — 같은 표시는 한 줄(effect_gap 작업 `gap:<kind>:<effect_key>` · failed).
--     닿는 참여·케이스를 전부 적어 그 케이스들의 종결을 막는다(0344c).
--   · 참여를 알면 서버가 그 자리에서 출결 효과를 **직접 다시 판정**한다(0345e) — 앱이 보낸 사유를 사실로 믿지 않는다.
--   · 닫히는 길: 서버 검증이 맞게 끝났을 때(0345e) 또는 재확인 명령(resolve_reconciliation {projection_id}).
-- makeup_projection_evidence(p_effect_key text) → {effect_key, participant_id, state, verification, evidence}
--   읽기 전용(완료로 바꾸지 않는다). 범위는 참여 명단과 같다. effect_key = `att:<참여 id>`.
-- reverify_job(지점, 행위자, 작업, 연결 여부) — 반영 작업을 **지금 사실로** 다시 확인한다. 요청이 완료를 정하지 못한다.
--   명령(resolve_reconciliation)은 연결까지(p_link = true), 대사 실행(0349e)은 관측만(false) 한다:
--   참여가 있으면 0345e 검증, 관측 실패 작업이면 그 출결 칸을 다시 관측, 연결되지 않은 기존 예약이면 그 예약·출결 칸의 지금 상태.
-- 멱등: create or replace.

drop function if exists makeup_private.reverify_job(makeup_private.actor_ctx, uuid);
create or replace function makeup_private.reverify_job(p_tenant uuid, p_actor uuid, p_job uuid, p_link boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_j public.makeup_projection_jobs%rowtype;
  v_parts uuid[];
  v_part uuid;
  v_resv uuid;
  v_eff jsonb;
  v_state text := 'done';
  v_ver jsonb := jsonb_build_object('ok', true);
  v_seen boolean := false;
begin
  select * into v_j from public.makeup_projection_jobs j where j.id = p_job;
  v_resv := makeup_private.p_uuid(v_j.payload, 'reservation_id');
  v_parts := array(select distinct x from unnest(v_j.participant_ids || v_j.participant_id) x where x is not null
                   union select m.participant_id from public.makeup_legacy_maps m
                          where m.tenant_id = p_tenant and m.legacy_kind = 'reservation' and m.legacy_id = v_resv
                            and m.state = 'active' and m.participant_id is not null
                   order by 1);
  if v_j.payload ? 'session_date' and makeup_private.p_uuid(v_j.payload, 'student_id') is not null then
    perform makeup_private.observe_attendance_cell(p_tenant, makeup_private.p_uuid(v_j.payload, 'student_id'),
      makeup_private.p_uuid(v_j.payload, 'class_id'), makeup_private.p_date(v_j.payload, 'session_date'), p_actor, p_link);
    v_seen := true;
    v_ver := jsonb_build_object('ok', true, 'code', 'reobserved');
  end if;
  foreach v_part in array v_parts loop
    perform 1 from public.makeup_participants x where x.id = v_part for update;
    v_eff := makeup_private.sync_attendance_effect(p_tenant, v_part, p_actor, p_link);
    v_seen := true;
    if v_eff ->> 'projection_state' = 'failed' or (v_eff ->> 'projection_state' = 'pending' and v_state = 'done') then
      v_state := v_eff ->> 'projection_state';
      v_ver := v_eff -> 'verification';
    elsif v_state = 'done' then
      v_ver := v_eff -> 'verification';
    end if;
  end loop;
  if cardinality(v_parts) = 0 and v_resv is not null then
    -- 연결되지 않은 기존 예약: 아직 대기(reserved)인데 그날 그 칸에 시수 상태 출결이 있으면 이행이 남은 것이다.
    v_seen := true;
    if exists (select 1 from public.makeup_reservations r
                where r.id = v_resv and r.tenant_id = p_tenant and r.status = 'reserved'
                  and exists (select 1 from public.attendance_records ar
                               where ar.tenant_id = r.tenant_id and ar.student_id = r.student_id and ar.class_id = r.class_id
                                 and ar.session_date = r.makeup_date and ar.status::text in ('present', 'late', 'early_leave', 'makeup'))) then
      v_state := 'failed';
      v_ver := jsonb_build_object('ok', false, 'code', 'legacy_pending', 'reservation_id', v_resv);
    else
      v_ver := jsonb_build_object('ok', true, 'code', 'legacy_settled', 'reservation_id', v_resv);
    end if;
  end if;
  -- 보고서 관측이 실패했던 작업: 그 보고서를 다시 관측한다(0349f). 결과는 대사 항목으로 남는다.
  if makeup_private.p_uuid(v_j.payload, 'report_id') is not null then
    perform makeup_private.observe_report(p_tenant, makeup_private.p_uuid(v_j.payload, 'report_id'), p_actor);
    v_seen := true;
    if v_state = 'done' then v_ver := jsonb_build_object('ok', true, 'code', 'reobserved'); end if;
  end if;
  if not v_seen then
    v_state := 'failed';
    v_ver := jsonb_build_object('ok', false, 'code', 'unverifiable');
  end if;
  -- 참여 자신의 작업(att:<참여>)은 검증 helper가 이미 적었다. 그 밖의 작업 줄은 여기서 결과를 적는다.
  update public.makeup_projection_jobs j
     set state = v_state, attempts = j.attempts + 1, last_error = case when v_state = 'done' then null else coalesce(v_ver ->> 'code', j.last_error) end
   where j.id = p_job and (j.kind <> 'attendance_effect' or j.participant_id is null);
  return jsonb_build_object('projection_state', v_state, 'verification', v_ver);
end;
$$;

create or replace function public.makeup_note_effect_gap(p_gap jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  a makeup_private.actor_ctx := makeup_private.actor();
  g jsonb := coalesce(p_gap, '{}'::jsonb);
  v_key text := makeup_private.p_text(g, 'effect_key');
  v_kind text := makeup_private.p_text(g, 'kind');
  v_part uuid := makeup_private.p_uuid(g, 'participant_id');
  v_resv uuid := makeup_private.p_uuid(g, 'reservation_id');
  v_err text := left(coalesce(makeup_private.p_text(g, 'error'), '보강 반영을 마치지 못했습니다'), 1000);
  v_parts uuid[];
  v_cases uuid[];
  v_job public.makeup_projection_jobs%rowtype;
  v_changed integer;
  v_state text;
  v_x uuid;
begin
  perform makeup_private.require_mode(a, 'read');
  perform makeup_private.require_level(a, 'write');
  if jsonb_typeof(g) <> 'object' or v_key is null or char_length(v_key) > 200 or v_kind is null or v_kind !~ '^[a-z][a-z_]{1,39}$'
     or (v_part is null and v_resv is null) then
    perform makeup_private.fail('invalid', '반영 실패 기록의 형식이 올바르지 않습니다');
  end if;
  if v_part is not null and not makeup_private.participant_in_scope(a, v_part) then
    perform makeup_private.fail('not_found', '보강 일정을 찾을 수 없습니다');
  end if;
  if v_resv is not null and not exists (
       select 1 from public.makeup_reservations r
        where r.id = v_resv and r.tenant_id = a.tenant_id
          and (a.wide or r.class_id in (select makeup_private.my_class_ids(a.tenant_id, a.user_id, a.today)))) then
    perform makeup_private.fail('not_found', '보강 예약을 찾을 수 없습니다');
  end if;
  v_parts := array(select v_part where v_part is not null
                   union select m.participant_id from public.makeup_legacy_maps m
                          where m.tenant_id = a.tenant_id and m.legacy_kind = 'reservation' and m.legacy_id = v_resv
                            and m.state = 'active' and m.participant_id is not null
                   order by 1);
  v_cases := array(select al.case_id from public.makeup_allocations al where al.participant_id = any (v_parts)
                   union select m.case_id from public.makeup_legacy_maps m
                          where m.tenant_id = a.tenant_id and m.legacy_kind = 'reservation' and m.legacy_id = v_resv and m.state = 'active'
                   order by 1);
  insert into public.makeup_projection_jobs as j (tenant_id, kind, effect_key, case_id, participant_id, case_ids, participant_ids,
      state, payload, last_error)
    values (a.tenant_id, 'effect_gap', 'gap:' || v_kind || ':' || v_key, v_cases[1], null, v_cases, v_parts, 'failed',
      jsonb_build_object('gap_kind', v_kind, 'source_effect_key', v_key, 'reservation_id', v_resv, 'noted_by', a.user_id), v_err)
    on conflict (tenant_id, effect_key) do update
      set state = 'failed', last_error = excluded.last_error, payload = excluded.payload, case_ids = excluded.case_ids,
          participant_ids = excluded.participant_ids, attempts = j.attempts + 1
      where (j.state, j.last_error, j.case_ids, j.participant_ids) is distinct from ('failed', excluded.last_error, excluded.case_ids, excluded.participant_ids);
  get diagnostics v_changed = row_count;
  select * into v_job from public.makeup_projection_jobs j where j.tenant_id = a.tenant_id and j.effect_key = 'gap:' || v_kind || ':' || v_key;
  if v_changed > 0 then
    perform makeup_private.log_event(a.tenant_id, 'projection', v_job.id, 'effect_gap_noted', a.user_id, null, v_cases[1], null, v_err,
      jsonb_build_object('kind', v_kind, 'effect_key', v_key, 'participant_ids', to_jsonb(v_parts), 'case_ids', to_jsonb(v_cases)));
  end if;
  -- 서버가 직접 다시 판정한다(연결은 하지 않는다 — 참여 기록은 명령의 일이다). 맞게 끝난 참여의 표시는 0345e가 닫는다.
  foreach v_x in array v_parts loop
    v_state := makeup_private.sync_attendance_effect(a.tenant_id, v_x, a.user_id, false) ->> 'projection_state';
  end loop;
  select * into v_job from public.makeup_projection_jobs j where j.id = v_job.id;
  return jsonb_build_object('queued', true, 'id', v_job.id, 'effect_key', v_key, 'kind', v_kind, 'state', v_job.state,
    'projection_state', v_state,
    'case_ids', coalesce((select jsonb_agg(c) from unnest(v_cases) c where makeup_private.in_scope(a, c)), '[]'::jsonb));
end;
$$;

create or replace function public.makeup_projection_evidence(p_effect_key text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  a makeup_private.actor_ctx := makeup_private.actor();
  v_part uuid;
  v_state text;
begin
  perform makeup_private.require_mode(a, 'read');
  if p_effect_key is null or p_effect_key !~ '^att:[0-9a-f-]{36}$' then
    perform makeup_private.fail('invalid', '확인할 반영 작업을 찾을 수 없습니다');
  end if;
  v_part := substr(p_effect_key, 5)::uuid;
  if not makeup_private.participant_in_scope(a, v_part) then
    perform makeup_private.fail('not_found', '보강 일정을 찾을 수 없습니다');
  end if;
  select j.state into v_state from public.makeup_projection_jobs j where j.tenant_id = a.tenant_id and j.effect_key = p_effect_key;
  return jsonb_build_object('effect_key', p_effect_key, 'participant_id', v_part, 'state', coalesce(v_state, 'pending'),
    'verification', makeup_private.verify_attendance_effect(a.tenant_id, v_part),
    'evidence', makeup_private.evidence_json(a.tenant_id, v_part));
end;
$$;

revoke all on function public.makeup_note_effect_gap(jsonb) from public, anon, service_role;
revoke all on function public.makeup_projection_evidence(text) from public, anon, service_role;
grant execute on function public.makeup_note_effect_gap(jsonb) to authenticated;
grant execute on function public.makeup_projection_evidence(text) to authenticated;
revoke all on all functions in schema makeup_private from public, anon, authenticated;
notify pgrst, 'reload schema';
