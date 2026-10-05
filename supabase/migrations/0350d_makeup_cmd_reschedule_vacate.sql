-- 0350d — 명령: 일정 변경(reschedule) — 다 비운 옛 회차는 새 자리를 검사하기 **전에** 닫는다
--
-- 0346d의 cmd_reschedule을 바꿔 끼운다(같은 파일의 예약·취소·배정 해제 도우미는 그대로다).
--   전에는 옛 회차를 '확정'으로 둔 채 새 회차의 자원 검사(0345b)를 했다. 그래서 학생이 한 명뿐인 회차를 같은 강사·같은 시간에
--   강의실만 바꾸면, 방금 비운 자기 옛 회차가 "같은 강사가 같은 시간에 다른 강의실"로 잡혀 변경이 항상 거절됐다.
--   · 옮길 참여를 다 풀고 나서 옛 회차에 남은 학생이 **없으면** 그 자리에서 변경됨(rescheduled)으로 닫은 뒤 새 자리를 잡는다.
--     새 회차 번호(replaced_by_session_id)는 새 자리를 잡은 뒤에 잇는다.
--   · 남은 학생이 **있으면** 옛 회차는 확정 그대로다 — 같은 강사가 같은 시간에 두 강의실을 맡게 되는 변경은 종전대로 거절된다.
--   · 한 명령 = 한 트랜잭션이다. 새 자리를 못 잡으면(정원·시간 겹침 등) 예외로 전부 되돌아가 옛 회차·참여·배정이 그대로 남는다.
-- 그 밖의 규칙(권한 · 개정 번호 · 잠금 순서 · 이미 참여를 기록한 일정은 옮기지 않음 · 이벤트)은 0346d와 같다.
-- 🔴 출결 · 시수 · 보고서를 쓰지 않는다.
-- 🔴 0346d를 손으로 다시 실행했으면 이 파일도 다시 실행한다(뒤에 실행한 정의가 남는다).
-- 멱등: create or replace.

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
  v_vacated boolean;
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
  -- 다 비운 옛 회차는 여기서 닫는다 — 새 회차의 강사·강의실 검사가 방금 비운 자기 회차를 충돌로 세지 않게.
  -- 학생이 남아 있으면 확정 그대로라, 같은 강사의 같은 시간 다른 강의실은 아래 book()이 종전대로 거절한다.
  v_vacated := not exists (select 1 from public.makeup_participants x where x.session_id = v_old.id and x.status <> 'cancelled');
  if v_vacated then
    update public.makeup_sessions s
       set state = 'rescheduled', cancel_reason = left(v_reason, 500), cancel_cause = 'reschedule'
     where s.id = v_old.id;
  end if;
  for v_m in select m from jsonb_array_elements(v_moves) m loop
    v_part := makeup_private.book(a, p_cmd, v_new, p - 'session_id', (v_m ->> 'student_id')::uuid, v_m -> 'allocs',
      case when (v_m ->> 'explicit_anchor')::boolean then (v_m ->> 'anchor')::uuid end, null, v_reason, 'rescheduled');
    select x.session_id into v_new from public.makeup_participants x where x.id = v_part;
    v_parts := v_parts || v_part;
  end loop;
  if v_vacated then
    update public.makeup_sessions s set replaced_by_session_id = v_new where s.id = v_old.id;
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
