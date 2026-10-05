-- 0345a — 보강 원장 공통 함수: 명령 표시 · 잠금 · 개정 번호 · 수량 재계산 · 이벤트 · 대사/반영 작업
--
-- 잠금 순서(모든 명령이 같은 순서를 지킨다 — 교착 방지):
--   ① 자원 잠금(advisory, 키 이름순): gate(지점 시간표 문) → room:방:날짜 → stu:학생:날짜 → tch:강사:날짜
--   ② 케이스 행(id순) → ③ 회차 → 참여 → 배정 행
--   정규 시간표 저장(0349b 트리거)은 ①의 gate만 잡는다. 기존 예약 표 저장(0349a)은 stu 키 하나만 잡는다.
-- 수량: O(남은 의무) = 목표 + 조정 − 인정 − 면제 · C(점유) = Σ(배정 − 인정 − 해제) · R(예약 가능) = O − C.
--   케이스의 캐시 칸은 항상 자식 표에서 **다시 계산**한다(증분으로 더하지 않는다 — 어긋날 길이 없다).
--   음수는 0으로 숨기지 않고 실패시킨다(0343a CHECK가 마지막 방어선).
-- 멱등: create or replace.

create or replace function makeup_private.enter() returns void
language plpgsql set search_path = pg_catalog as $$
begin
  perform set_config('makeup.ctx', pg_current_xact_id()::text, true);
end;
$$;

create or replace function makeup_private.lock_keys(p_tenant uuid, p_keys text[]) returns void
language plpgsql set search_path = pg_catalog as $$
declare k text;
begin
  for k in select distinct x from unnest(p_keys) x where x is not null order by x loop
    perform pg_advisory_xact_lock(hashtextextended('makeup:' || p_tenant::text || ':' || k, 0));
  end loop;
end;
$$;

-- 케이스 행을 id순으로 잠근다. 다른 학원·없는 케이스가 섞이면 실패.
create or replace function makeup_private.lock_cases(p_tenant uuid, p_ids uuid[]) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n integer;
begin
  select count(*) into v_n from (
    select c.id from public.makeup_cases c where c.tenant_id = p_tenant and c.id = any (p_ids) order by c.id for update) q;
  if v_n <> (select count(distinct x) from unnest(p_ids) x) then
    perform makeup_private.fail('not_found', '보강 건을 찾을 수 없습니다 — 새로 고친 뒤 다시 확인해 주세요');
  end if;
end;
$$;

-- 낙관 동시성: 화면이 본 개정 번호와 지금 번호가 다르면 덮어쓰지 않고 거절한다.
create or replace function makeup_private.check_revision(p_expected integer, p_actual integer, p_required boolean default true)
returns void language plpgsql set search_path = pg_catalog as $$
begin
  if (p_expected is null and p_required) or (p_expected is not null and p_expected <> p_actual) then
    perform makeup_private.fail('stale_revision', '다른 사람이 먼저 변경했습니다 — 새로 고친 뒤 다시 시도해 주세요',
      jsonb_build_object('current_revision', p_actual));
  end if;
end;
$$;

create or replace function makeup_private.recompute_case(p_case uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.makeup_cases c set
      adjusted_minutes = q.adjusted, waived_minutes = q.waived,
      recognized_minutes = q.recognized, committed_minutes = q.committed
    from (
      select
        coalesce((select sum(a.minutes) from public.makeup_adjustments a where a.case_id = p_case and a.kind = 'quantity'), 0)::integer as adjusted,
        coalesce((select sum(a.minutes) from public.makeup_adjustments a where a.case_id = p_case and a.kind = 'waiver'), 0)::integer as waived,
        coalesce((select sum(case r.kind when 'recognize' then r.minutes else -r.minutes end)
                    from public.makeup_recognitions r where r.case_id = p_case), 0)::integer as recognized,
        coalesce((select sum(al.allocated_minutes - al.recognized_minutes - al.released_minutes)
                    from public.makeup_allocations al where al.case_id = p_case), 0)::integer as committed) q
   where c.id = p_case
     and (c.adjusted_minutes, c.waived_minutes, c.recognized_minutes, c.committed_minutes)
         is distinct from (q.adjusted, q.waived, q.recognized, q.committed);
exception when check_violation then
  perform makeup_private.fail('conflict', '남은 분량보다 많이 처리할 수 없습니다 — 남은 분량과 잡힌 일정을 확인해 주세요');
end;
$$;

create or replace function makeup_private.quantities(p_case uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'target', c.target_minutes, 'adjusted', c.adjusted_minutes, 'recognized', c.recognized_minutes,
    'waived', c.waived_minutes, 'outstanding', c.outstanding_minutes, 'committed', c.committed_minutes,
    'reservable', c.outstanding_minutes - c.committed_minutes)
  from public.makeup_cases c where c.id = p_case
$$;

create or replace function makeup_private.log_event(
  p_tenant uuid, p_entity_type text, p_entity_id uuid, p_event_type text, p_actor uuid, p_command uuid,
  p_case uuid default null, p_session uuid default null, p_reason text default null,
  p_data jsonb default '{}'::jsonb, p_from_rev integer default null, p_to_rev integer default null
) returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.makeup_events (tenant_id, entity_type, entity_id, event_type, actor_id, command_id,
    case_id, session_id, reason, data, from_revision, to_revision)
  values (p_tenant, p_entity_type, p_entity_id, p_event_type, p_actor, p_command,
    p_case, p_session, nullif(left(btrim(coalesce(p_reason, '')), 500), ''), coalesce(p_data, '{}'::jsonb), p_from_rev, p_to_rev)
$$;

-- 사람이 읽는 요약을 기존 감사로그에도 남긴다(같은 command_id로 원장 이벤트와 이어진다).
create or replace function makeup_private.audit(a makeup_private.actor_ctx, p_action text, p_label text, p_meta jsonb)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.audit_logs (tenant_id, actor_id, actor_name, action, target_type, target_label, metadata)
  values (a.tenant_id, a.user_id, a.name, 'makeup_' || p_action, 'makeup', left(p_label, 200), p_meta)
$$;

-- 대사 항목을 연다. 같은 문제는 한 줄이다. 내용이 달라지면 같은 줄을 갱신하고(닫혀 있었으면 다시 연다),
-- 사람이 닫은 뒤 **같은 내용**으로 다시 발견되면 닫힌 채 둔다. 자동으로 닫힌 줄은 detail에 auto_resolved 표식이 붙어
-- 같은 문제가 다시 생기면 다시 열린다.
create or replace function makeup_private.open_recon(
  p_tenant uuid, p_kind text, p_key text, p_blocks boolean, p_case uuid, p_participant uuid,
  p_session uuid, p_attendance uuid, p_legacy uuid, p_detail jsonb
) returns void language sql security definer set search_path = public, pg_temp as $$
  -- detail.case_ids가 있으면 닿는 케이스 전부를 case_ids 칸에 적는다(1:N — 목록·종결 차단이 이 칸까지 본다).
  insert into public.makeup_reconciliation as r (tenant_id, kind, dedupe_key, blocks_close, case_id, participant_id,
    session_id, attendance_record_id, legacy_id, detail, case_ids)
  values (p_tenant, p_kind, p_key, p_blocks, p_case, p_participant, p_session, p_attendance, p_legacy,
    coalesce(p_detail, '{}'::jsonb),
    coalesce(array(select x::uuid from jsonb_array_elements_text(
      case when jsonb_typeof(p_detail -> 'case_ids') = 'array' then p_detail -> 'case_ids' else '[]'::jsonb end) x), '{}'::uuid[]))
  on conflict (tenant_id, dedupe_key) do update
    set state = 'open', resolved_at = null, resolved_by = null, resolution_note = null, detail = excluded.detail,
        case_ids = excluded.case_ids, blocks_close = excluded.blocks_close, case_id = excluded.case_id,
        participant_id = excluded.participant_id, session_id = excluded.session_id,
        attendance_record_id = excluded.attendance_record_id, legacy_id = excluded.legacy_id
    where r.detail is distinct from excluded.detail
$$;

-- 반영 작업(같은 효과 = 같은 줄). 이미 반영한 출결 행이 그대로면 done을 유지하고, 달라졌으면 다시 연다.
create or replace function makeup_private.note_projection(
  p_tenant uuid, p_kind text, p_key text, p_case uuid, p_participant uuid, p_payload jsonb
) returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.makeup_projection_jobs as j (tenant_id, kind, effect_key, case_id, participant_id, payload)
  values (p_tenant, p_kind, p_key, p_case, p_participant, coalesce(p_payload, '{}'::jsonb))
  on conflict (tenant_id, effect_key) do update
    set payload = excluded.payload, last_error = null,
        state = case when j.state = 'done' and j.payload -> 'attendance_record_id' = excluded.payload -> 'attendance_record_id'
                     then 'done' else 'pending' end
    where j.payload is distinct from excluded.payload
$$;

-- 아직 살아 있는 약속(해제·인정 전 배정) 목록 — 면제·거절·종결을 거절할 때 그대로 보여 준다.
create or replace function makeup_private.live_commitments(p_case uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'session_id', s.id, 'participant_id', p.id, 'session_date', s.session_date,
      'start_time', to_char(s.start_time, 'HH24:MI'), 'end_time', to_char(s.end_time, 'HH24:MI'),
      'status', p.status, 'minutes', al.allocated_minutes - al.recognized_minutes - al.released_minutes)
    order by s.session_date, s.start_time), '[]'::jsonb)
  from public.makeup_allocations al
  join public.makeup_participants p on p.id = al.participant_id
  join public.makeup_sessions s on s.id = p.session_id
  where al.case_id = p_case and al.allocated_minutes - al.recognized_minutes - al.released_minutes > 0
$$;

-- 종결을 막는 것: 살아 있는 약속 · 미처리(pending/failed) 반영 작업 · 종결을 막는 열린 대사.
-- 한 참여가 여러 케이스에 걸려 있으면 그 참여의 미결 항목은 연결된 케이스 전부를 막는다.
create or replace function makeup_private.close_blockers(p_tenant uuid, p_case uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'commitments', makeup_private.live_commitments(p_case),
    'projections', (select count(*) from public.makeup_projection_jobs j
                     where j.tenant_id = p_tenant and j.state in ('pending', 'failed') and makeup_private.job_touches(j, p_case)),
    'reconciliation', (select count(*) from public.makeup_reconciliation r
                        where r.tenant_id = p_tenant and r.state = 'open' and r.blocks_close and makeup_private.recon_touches(r, p_case)))
$$;

create or replace function makeup_private.assert_closable(p_tenant uuid, p_case uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v jsonb := makeup_private.close_blockers(p_tenant, p_case);
begin
  if jsonb_array_length(v -> 'commitments') > 0 then
    perform makeup_private.fail('live_commitments', '잡혀 있는 보강 일정이 있습니다 — 일정을 먼저 취소하거나 검토를 마친 뒤 다시 시도해 주세요', v);
  end if;
  if (v ->> 'projections')::integer > 0 or (v ->> 'reconciliation')::integer > 0 then
    perform makeup_private.fail('conflict', '확인이 끝나지 않은 항목이 있습니다 — 확인 필요 목록을 먼저 처리해 주세요', v);
  end if;
end;
$$;

-- 명령 결과의 공통 모양(id · revision · replayed · effect_key 는 항상 있다).
create or replace function makeup_private.result(
  p_action text, p_id uuid, p_revision integer, p_effect_key text, p_case_ids uuid[], p_extra jsonb default '{}'::jsonb
) returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', p_id, 'revision', p_revision, 'replayed', false, 'effect_key', p_effect_key, 'action', p_action,
    'case_id', case when cardinality(p_case_ids) = 1 then p_case_ids[1] end,
    'case_ids', to_jsonb(coalesce(p_case_ids, '{}'::uuid[])),
    'session_id', null, 'participant_id', null, 'fulfillment_id', null, 'warnings', '[]'::jsonb,
    'quantities', case when cardinality(p_case_ids) = 1 then makeup_private.quantities(p_case_ids[1]) end)
    || coalesce(p_extra, '{}'::jsonb)
$$;

revoke all on all functions in schema makeup_private from public, anon, authenticated;
