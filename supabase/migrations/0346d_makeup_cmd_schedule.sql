-- 0346d — 명령: 예약(reserve) · 일정 변경(reschedule) · 취소(cancel) + 배정 해제 도우미
--
-- 취소·변경은 기존 시도를 **지우지 않고** 남긴다: 참여는 cancelled, 배정은 해제량으로, 회차는 cancelled/rescheduled.
-- 남은 의무(O)는 그대로라 같은 케이스를 다른 날짜로 다시 잡을 수 있다.
--   · 한 학생만 취소하면 다른 학생의 회차는 그대로다. 남은 학생이 없을 때만 회차가 닫힌다.
--   · 이미 참여를 기록한(왔다/안 왔다) 일정은 취소·변경하지 않는다 — 참여 기록을 정정하는 길이 따로 있다.
-- 🔴 취소는 **일정만** 취소한다. 원결석 칸·메모·출결 행·보고서·진도는 건드리지 않는다(기존 `removeMakeupEntry`의
--    삭제 부작용을 복사하지 않는다). 출결 화면용 예약 행(0264a)만 같은 트랜잭션에서 지우고, 연결 행은
--    released로 스냅샷과 함께 남긴다.
-- 잠금: 변경은 gate·학생-날짜 키를 **케이스 잠금보다 먼저** 잡는다(0345a 순서). book()의 재잠금은 재진입이다.
-- 멱등: create or replace.

-- 한 참여의 살아 있는 배정을 전부 푼다. p_cancel = 참여를 취소 상태로 바꿀지(노쇼는 상태를 유지한다).
create or replace function makeup_private.release_participant(
  a makeup_private.actor_ctx, p_cmd uuid, p_part uuid, p_reason text, p_cancel boolean, p_note text
) returns uuid[] language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_cases uuid[];
  v_case uuid;
  v_session uuid;
  v_legacy uuid;
begin
  select array_agg(al.case_id order by al.case_id) into v_cases
    from public.makeup_allocations al where al.participant_id = p_part and al.tenant_id = a.tenant_id;
  perform makeup_private.lock_cases(a.tenant_id, coalesce(v_cases, '{}'::uuid[]));
  select p.session_id into v_session from public.makeup_participants p where p.id = p_part for update;
  update public.makeup_allocations al
     set released_minutes = al.allocated_minutes - al.recognized_minutes, release_reason = p_reason
   where al.participant_id = p_part and al.allocated_minutes - al.recognized_minutes - al.released_minutes > 0;
  if p_cancel then
    update public.makeup_participants p set status = 'cancelled', cancel_reason = left(p_note, 500)
     where p.id = p_part and p.status <> 'cancelled';
  end if;
  for v_legacy in select distinct m.legacy_id from public.makeup_legacy_maps m
                   where m.tenant_id = a.tenant_id and m.participant_id = p_part and m.state = 'active' loop
    delete from public.makeup_reservations r where r.id = v_legacy and r.tenant_id = a.tenant_id;
    update public.makeup_legacy_maps m set state = 'released', target_revision = m.target_revision + 1
     where m.legacy_kind = 'reservation' and m.legacy_id = v_legacy and m.state = 'active';
  end loop;
  foreach v_case in array coalesce(v_cases, '{}'::uuid[]) loop
    perform makeup_private.recompute_case(v_case);
    perform makeup_private.log_event(a.tenant_id, 'participant', p_part,
      case when p_cancel then 'participant_cancelled' else 'allocation_released' end,
      a.user_id, p_cmd, v_case, v_session, p_note, jsonb_build_object('release_reason', p_reason));
  end loop;
  return coalesce(v_cases, '{}'::uuid[]);
end;
$$;

create or replace function makeup_private.cmd_reserve(a makeup_private.actor_ctx, p_cmd uuid, p jsonb, p_rev integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_part public.makeup_participants%rowtype;
  v_id uuid;
begin
  perform makeup_private.require_level(a, 'write');
  v_id := makeup_private.book(a, p_cmd, makeup_private.p_uuid(p, 'session_id'), p, makeup_private.p_uuid(p, 'student_id'),
    p -> 'allocations', makeup_private.p_uuid(p, 'anchor_class_id'), makeup_private.p_int(p, 'planned_minutes'),
    coalesce(makeup_private.p_text(p, 'note'), makeup_private.p_text(p, 'reason')), 'reserved');
  select * into v_part from public.makeup_participants x where x.id = v_id;
  perform makeup_private.audit(a, 'reserve', '보강 일정 확정', jsonb_build_object('command_id', p_cmd, 'participant_id', v_id));
  return makeup_private.result('reserve', v_id, v_part.revision, 'part:' || v_id::text,
    array(select al.case_id from public.makeup_allocations al where al.participant_id = v_id order by al.case_id),
    jsonb_build_object('session_id', v_part.session_id, 'participant_id', v_id,
      'session', makeup_private.session_json(v_part.session_id)));
end;
$$;

create or replace function makeup_private.cmd_cancel(a makeup_private.actor_ctx, p_cmd uuid, p jsonb, p_rev integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_part_id uuid := makeup_private.p_uuid(p, 'participant_id');
  v_session_id uuid := makeup_private.p_uuid(p, 'session_id');
  v_reason text := makeup_private.p_text(p, 'reason');
  v_cause text := coalesce(makeup_private.p_text(p, 'cause'), 'student');
  v_s public.makeup_sessions%rowtype;
  v_targets uuid[];
  v_cases uuid[];
  v_t uuid; v_rev integer;
begin
  perform makeup_private.require_level(a, 'write');
  if v_reason is null then perform makeup_private.fail('invalid', '취소 사유를 적어 주세요'); end if;
  if v_cause not in ('student', 'academy') then perform makeup_private.fail('invalid', '취소 원인을 골라 주세요'); end if;
  if v_part_id is not null then
    select p.session_id into v_session_id from public.makeup_participants p where p.id = v_part_id and p.tenant_id = a.tenant_id;
  end if;
  select * into v_s from public.makeup_sessions s where s.id = v_session_id and s.tenant_id = a.tenant_id;
  if not found then perform makeup_private.fail('not_found', '보강 일정을 찾을 수 없습니다'); end if;
  perform makeup_private.check_revision(p_rev, coalesce(
    (select x.revision from public.makeup_participants x where x.id = v_part_id), v_s.revision));
  select array_agg(p.id order by p.id) into v_targets from public.makeup_participants p
   where p.session_id = v_s.id and p.status <> 'cancelled' and (v_part_id is null or p.id = v_part_id);
  select array_agg(distinct al.case_id) into v_cases from public.makeup_allocations al where al.participant_id = any (v_targets);
  if v_targets is null then perform makeup_private.fail('conflict', '이미 취소된 일정입니다'); end if;
  if not a.wide and v_s.teacher_id is distinct from a.user_id
     and exists (select 1 from unnest(v_cases) c where not makeup_private.in_scope(a, c)) then
    perform makeup_private.fail('forbidden', '담당 범위 밖의 일정입니다');
  end if;
  perform makeup_private.lock_cases(a.tenant_id, coalesce(v_cases, '{}'::uuid[]));
  select * into v_s from public.makeup_sessions s where s.id = v_s.id for update;
  v_rev := v_s.revision;
  if v_part_id is not null then
    select x.revision into v_rev from public.makeup_participants x where x.id = v_part_id for update;
  end if;
  perform makeup_private.check_revision(p_rev, v_rev);
  if v_s.state <> 'confirmed' or exists (
       select 1 from public.makeup_participants p where p.id = any (v_targets) and p.status <> 'unknown') then
    perform makeup_private.fail('conflict', '이미 참여를 기록했거나 끝난 일정입니다 — 참여 기록을 먼저 정정해 주세요');
  end if;
  foreach v_t in array v_targets loop
    perform makeup_private.release_participant(a, p_cmd, v_t, 'cancelled', true, v_reason);
  end loop;
  if not exists (select 1 from public.makeup_participants p where p.session_id = v_s.id and p.status <> 'cancelled') then
    update public.makeup_sessions s set state = 'cancelled', cancel_reason = left(v_reason, 500), cancel_cause = v_cause
     where s.id = v_s.id returning * into v_s;
    perform makeup_private.log_event(a.tenant_id, 'session', v_s.id, 'session_cancelled', a.user_id, p_cmd, null, v_s.id,
      v_reason, jsonb_build_object('cause', v_cause));
  end if;
  perform makeup_private.audit(a, 'cancel', '보강 일정 취소', jsonb_build_object('command_id', p_cmd, 'session_id', v_s.id));
  return makeup_private.result('cancel', coalesce(v_part_id, v_s.id),
    coalesce((select p.revision from public.makeup_participants p where p.id = v_part_id), v_s.revision),
    'cancel:' || coalesce(v_part_id, v_s.id)::text, coalesce(v_cases, '{}'::uuid[]),
    jsonb_build_object('session_id', v_s.id, 'participant_id', v_part_id, 'session', makeup_private.session_json(v_s.id)));
end;
$$;

create or replace function makeup_private.cmd_reschedule(a makeup_private.actor_ctx, p_cmd uuid, p jsonb, p_rev integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old_id uuid := makeup_private.p_uuid(p, 'session_id');
  v_only uuid := makeup_private.p_uuid(p, 'participant_id');
  v_reason text := makeup_private.p_text(p, 'reason');
  v_date date := makeup_private.p_date(p, 'session_date');
  v_old public.makeup_sessions%rowtype;
  v_moves jsonb;
  v_m jsonb;
  v_cases uuid[];
  v_new uuid;
  v_part uuid;
  v_parts uuid[] := '{}';
begin
  perform makeup_private.require_level(a, 'write');
  if v_reason is null then perform makeup_private.fail('invalid', '일정을 바꾸는 사유를 적어 주세요'); end if;
  select * into v_old from public.makeup_sessions s where s.id = v_old_id and s.tenant_id = a.tenant_id;
  if not found then perform makeup_private.fail('not_found', '보강 일정을 찾을 수 없습니다'); end if;
  if not a.wide and v_old.teacher_id is distinct from a.user_id then
    perform makeup_private.fail('forbidden', '본인이 맡은 보강 일정만 바꿀 수 있습니다');
  end if;
  perform makeup_private.check_revision(p_rev, v_old.revision); -- 옛 화면이면 먼저 알린다(잠금 뒤에 다시 본다)
  -- 옮길 참여와 그 배정(살아 있는 분)을 먼저 적어 둔다.
  select jsonb_agg(jsonb_build_object('participant_id', x.id, 'student_id', x.student_id, 'anchor', x.anchor_class_id,
           'allocs', (select jsonb_agg(jsonb_build_object('case_id', al.case_id,
                        'minutes', al.allocated_minutes - al.recognized_minutes - al.released_minutes) order by al.case_id)
                        from public.makeup_allocations al
                       where al.participant_id = x.id and al.allocated_minutes - al.recognized_minutes - al.released_minutes > 0),
           'explicit_anchor', not exists (select 1 from public.makeup_allocations al join public.makeup_cases c on c.id = al.case_id
                                           where al.participant_id = x.id and c.original_class_id = x.anchor_class_id))
         order by x.id)
    into v_moves
    from public.makeup_participants x
   where x.session_id = v_old.id and x.status <> 'cancelled' and (v_only is null or x.id = v_only);
  select array_agg(distinct al.case_id) into v_cases from public.makeup_allocations al
   where al.participant_id in (select (m ->> 'participant_id')::uuid from jsonb_array_elements(coalesce(v_moves, '[]'::jsonb)) m);
  if v_moves is null then perform makeup_private.fail('conflict', '옮길 일정이 없습니다 — 이미 취소되었습니다'); end if;
  perform makeup_private.lock_keys(a.tenant_id, array['gate'] || array(
    select 'stu:' || (m ->> 'student_id') || ':' || v_date::text from jsonb_array_elements(v_moves) m));
  perform makeup_private.lock_cases(a.tenant_id, array(select c from unnest(v_cases) c where c is not null));
  select * into v_old from public.makeup_sessions s where s.id = v_old.id for update;
  perform makeup_private.check_revision(p_rev, v_old.revision);
  if v_old.state <> 'confirmed' or exists (
       select 1 from public.makeup_participants x
        where x.id in (select (m ->> 'participant_id')::uuid from jsonb_array_elements(v_moves) m) and x.status <> 'unknown') then
    perform makeup_private.fail('conflict', '이미 참여를 기록했거나 끝난 일정입니다 — 참여 기록을 먼저 정정해 주세요');
  end if;
  for v_m in select m from jsonb_array_elements(v_moves) m loop
    perform makeup_private.release_participant(a, p_cmd, (v_m ->> 'participant_id')::uuid, 'rescheduled', true, v_reason);
  end loop;
  for v_m in select m from jsonb_array_elements(v_moves) m loop
    v_part := makeup_private.book(a, p_cmd, v_new, p - 'session_id', (v_m ->> 'student_id')::uuid, v_m -> 'allocs',
      case when (v_m ->> 'explicit_anchor')::boolean then (v_m ->> 'anchor')::uuid end, null, v_reason, 'rescheduled');
    select x.session_id into v_new from public.makeup_participants x where x.id = v_part;
    v_parts := v_parts || v_part;
  end loop;
  if not exists (select 1 from public.makeup_participants x where x.session_id = v_old.id and x.status <> 'cancelled') then
    update public.makeup_sessions s
       set state = 'rescheduled', replaced_by_session_id = v_new, cancel_reason = left(v_reason, 500), cancel_cause = 'reschedule'
     where s.id = v_old.id;
  end if;
  perform makeup_private.log_event(a.tenant_id, 'session', v_old.id, 'session_rescheduled', a.user_id, p_cmd, null, v_old.id,
    v_reason, jsonb_build_object('new_session_id', v_new, 'participant_ids', to_jsonb(v_parts)));
  perform makeup_private.audit(a, 'reschedule', '보강 일정 변경', jsonb_build_object('command_id', p_cmd, 'session_id', v_new));
  return makeup_private.result('reschedule', v_new, (select s.revision from public.makeup_sessions s where s.id = v_new),
    'resched:' || v_old.id::text || ':' || v_new::text, array(select c from unnest(v_cases) c where c is not null),
    jsonb_build_object('session_id', v_new, 'previous_session_id', v_old.id, 'participant_ids', to_jsonb(v_parts),
      'session', makeup_private.session_json(v_new)));
end;
$$;

revoke all on all functions in schema makeup_private from public, anon, authenticated;
