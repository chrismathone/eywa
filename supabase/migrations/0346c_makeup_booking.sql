-- 0346c — 예약 확정의 본체(book): 예약(reserve)과 일정 변경(reschedule)이 같이 쓴다
--
-- 한 번의 호출 = 학생 한 명의 참여 1건 + 그 참여에 거는 배정 N건(케이스별 분). 회차는 새로 만들거나
-- (session_date·period_ids·강사·강의실) 이미 있는 회차에 합류한다(p_session_id — 다른 학생과 같은 회차).
-- 순서: 자원 잠금(gate·학생-날짜) → 케이스 잠금 → 서버 재검증(권한·수량·교시·강사·강의실·정원·학생 일정·
--        기존 기록 충돌) → 회차/참여/배정 쓰기 → 수량 재계산 → 출결 화면용 예약 행 투영 → 이벤트.
-- 🔴 예약은 배정량만 확보한다 — 남은 의무(O)는 줄지 않는다. 배정 합은 예약 가능량(R = O − C)을 넘지 못한다.
-- 🔴 예약은 출결·시수·보고서를 쓰지 않는다. 출결 화면용 예약 행(0264a)만 같은 트랜잭션에서 만든다:
--    원결석이 있고 그 결석일이 보강일과 다른 케이스가 있을 때만(대표 = 가장 이른 원수업일), 앵커 반이 유효할 때만.
--    한 참여에 케이스가 여럿이면 예약 행은 1건이고 연결 행(makeup_legacy_maps)이 케이스 수만큼 붙는다.
--    추가 지도(원결석 없음)는 예약 행을 만들지 않는다 — 명단은 원장에서 읽는다.
-- 멱등: create or replace.

create or replace function makeup_private.book(
  a makeup_private.actor_ctx, p_cmd uuid, p_session_id uuid, p_spec jsonb, p_student uuid, p_allocs jsonb,
  p_anchor_req uuid, p_planned integer, p_note text, p_event text
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_case_ids uuid[];
  v_total integer;
  v_date date;
  v_s public.makeup_sessions%rowtype;
  v_c public.makeup_cases%rowtype;
  v_subject text;
  v_first_class uuid;
  v_rep public.makeup_cases%rowtype;
  v_start time; v_end time; v_label text; v_ids text[];
  v_teacher uuid; v_room uuid; v_host uuid; v_cap integer; v_room_cap integer;
  v_minutes integer; v_duration integer; v_anchor uuid;
  v_part uuid; v_alloc uuid; v_legacy uuid; v_snap jsonb;
begin
  if jsonb_typeof(p_allocs) is distinct from 'array' or jsonb_array_length(p_allocs) not between 1 and 20 then
    perform makeup_private.fail('invalid', '보강할 건과 분량을 골라 주세요');
  end if;
  select array_agg(makeup_private.p_uuid(x, 'case_id')), sum(makeup_private.p_int(x, 'minutes'))
    into v_case_ids, v_total from jsonb_array_elements(p_allocs) x;
  if exists (select 1 from jsonb_array_elements(p_allocs) x
              where makeup_private.p_uuid(x, 'case_id') is null
                 or coalesce(makeup_private.p_int(x, 'minutes'), 0) not between 1 and 600)
     or cardinality(v_case_ids) <> (select count(distinct c) from unnest(v_case_ids) c) then
    perform makeup_private.fail('invalid', '보강 건마다 배정할 분량을 한 번씩 넣어 주세요');
  end if;
  if p_student is null then perform makeup_private.fail('invalid', '학생을 골라 주세요'); end if;

  if p_session_id is not null then
    select s.session_date into v_date from public.makeup_sessions s where s.id = p_session_id and s.tenant_id = a.tenant_id;
    if not found then perform makeup_private.fail('not_found', '보강 회차를 찾을 수 없습니다'); end if;
  else
    v_date := makeup_private.p_date(p_spec, 'session_date');
  end if;
  if v_date is null then perform makeup_private.fail('invalid', '보강 날짜를 골라 주세요'); end if;
  if v_date < a.today then
    perform makeup_private.fail('invalid', '지난 날짜에는 새 보강 일정을 잡을 수 없습니다');
  end if;

  perform makeup_private.lock_keys(a.tenant_id, array['gate', 'stu:' || p_student::text || ':' || v_date::text]);
  perform makeup_private.lock_cases(a.tenant_id, v_case_ids);

  for v_c in select c.* from public.makeup_cases c where c.id = any (v_case_ids) order by c.original_date nulls last, c.id loop
    v_subject := coalesce(v_subject, v_c.subject_key);
    v_first_class := coalesce(v_first_class, v_c.original_class_id);
    if v_c.student_id <> p_student then
      perform makeup_private.fail('invalid', '다른 학생의 보강 건은 함께 잡을 수 없습니다');
    end if;
    if v_c.subject_key <> v_subject then
      perform makeup_private.fail('invalid', '과목이 다른 보강 건은 한 회차에 함께 잡을 수 없습니다');
    end if;
    if not makeup_private.in_scope(a, v_c.id) then
      perform makeup_private.fail('forbidden', '담당 범위 밖의 보강 건입니다');
    end if;
    if v_c.lifecycle <> 'open' then
      perform makeup_private.fail('conflict', case when v_c.lifecycle = 'on_hold'
        then '보류 중인 보강 건입니다 — 다시 진행으로 바꾼 뒤 일정을 잡아 주세요' else '종결한 보강 건입니다' end);
    end if;
    if v_c.eligibility <> 'approved' then
      perform makeup_private.fail('conflict', '승인 전에는 보강 일정을 확정할 수 없습니다');
    end if;
    -- 추가 지도: 출결 반과 수납·급여 처리 기준이 운영 결정 전이다 → 첫 출시에서는 접수·승인까지만, 일정 확정은 항상 거절.
    if v_c.reason = 'additional' then
      perform makeup_private.fail('conflict', '추가 지도는 출결 반과 수납 처리 기준이 정해진 뒤에 일정을 확정할 수 있습니다');
    end if;
    if v_c.due_date is not null and v_date > v_c.due_date and not a.privileged then
      perform makeup_private.fail('conflict', '처리 기한이 지난 날짜입니다 — 관리자에게 기한 조정을 요청해 주세요');
    end if;
    if not a.wide and not makeup_private.within_teacher_deadline(v_c.original_date, v_date) then
      perform makeup_private.fail('conflict', '보강 기한이 지난 결석입니다 — 결석한 달의 다음 달 말일까지만 잡을 수 있습니다');
    end if;
    select makeup_private.p_int(x, 'minutes') into v_minutes
      from jsonb_array_elements(p_allocs) x where makeup_private.p_uuid(x, 'case_id') = v_c.id;
    if v_minutes > v_c.outstanding_minutes - v_c.committed_minutes then
      perform makeup_private.fail('conflict', '남은 분량보다 많이 잡을 수 없습니다 — 남은 분량을 확인해 주세요',
        jsonb_build_object('case_id', v_c.id, 'reservable', v_c.outstanding_minutes - v_c.committed_minutes));
    end if;
    if v_rep.id is null and v_c.original_date is not null and v_c.original_date <> v_date then v_rep := v_c; end if;
  end loop;
  if not (v_subject = any (a.pilot_subjects)) then
    perform makeup_private.fail('invalid', '이 과목은 아직 보강관리에서 다루지 않습니다');
  end if;

  if p_session_id is not null then
    select * into v_s from public.makeup_sessions s where s.id = p_session_id for update;
    if v_s.state <> 'confirmed' or v_s.subject_key <> v_subject then
      perform makeup_private.fail('conflict', '합류할 수 없는 회차입니다 — 이미 끝났거나 과목이 다릅니다');
    end if;
    v_start := v_s.start_time; v_end := v_s.end_time; v_label := v_s.period_label;
    v_teacher := v_s.teacher_id; v_room := v_s.classroom_id;
    select * into v_cap, v_room_cap from makeup_private.resolve_capacity(a.tenant_id, v_teacher, v_room, v_s.capacity);
  else
    select * into v_start, v_end, v_label, v_ids from makeup_private.resolve_periods(a.tenant_id, v_subject, v_date,
      array(select jsonb_array_elements_text(case when jsonb_typeof(p_spec -> 'period_ids') = 'array'
                                                  then p_spec -> 'period_ids' else '[]'::jsonb end)));
    -- 요청이 시각을 같이 보냈으면 교시표에서 만든 값과 같아야 한다(자유 시각 위조 거절).
    if (p_spec ? 'start_time' and left(p_spec ->> 'start_time', 5) <> to_char(v_start, 'HH24:MI'))
       or (p_spec ? 'end_time' and left(p_spec ->> 'end_time', 5) <> to_char(v_end, 'HH24:MI')) then
      perform makeup_private.fail('invalid', '교시 시각이 학원 설정의 교시표와 다릅니다 — 교시를 다시 골라 주세요');
    end if;
    v_host := makeup_private.p_uuid(p_spec, 'class_id');
    if v_host is not null and not exists (select 1 from public.classes c where c.id = v_host and c.tenant_id = a.tenant_id) then
      perform makeup_private.fail('not_found', '합류할 반을 찾을 수 없습니다');
    end if;
    v_teacher := makeup_private.p_uuid(p_spec, 'teacher_id'); v_room := makeup_private.p_uuid(p_spec, 'classroom_id');
    select * into v_teacher, v_room from makeup_private.resolve_host(a.tenant_id, v_host, v_date, v_start, v_end, v_teacher, v_room);
    select * into v_cap, v_room_cap from makeup_private.resolve_capacity(a.tenant_id, v_teacher, v_room, makeup_private.p_int(p_spec, 'capacity'));
  end if;
  if not a.wide and v_teacher <> a.user_id then
    perform makeup_private.fail('forbidden', '본인이 맡는 보강만 잡을 수 있습니다 — 다른 강사의 일정은 관리자에게 요청해 주세요');
  end if;
  v_duration := (extract(epoch from (v_end - v_start)) / 60)::integer;
  v_minutes := coalesce(p_planned, v_duration);
  if v_minutes not between 1 and least(v_duration, 600) or v_total > v_minutes then
    perform makeup_private.fail('invalid', '회차 길이보다 많이 배정할 수 없습니다 — 분량을 확인해 주세요');
  end if;
  v_anchor := makeup_private.resolve_anchor(a.tenant_id, p_student, v_subject, v_date, p_anchor_req, v_first_class);
  perform makeup_private.check_student(a.tenant_id, p_student, v_subject, v_date, v_start, v_end, v_teacher, v_anchor);
  perform makeup_private.check_session_resources(a.tenant_id, p_session_id, v_date, v_start, v_end, v_teacher, v_room, v_cap, v_room_cap, 1);

  if p_session_id is null then
    insert into public.makeup_sessions (tenant_id, class_id, teacher_id, classroom_id, subject_key, session_date,
        start_time, end_time, period_ids, period_label, capacity, created_by)
      values (a.tenant_id, v_host, v_teacher, v_room, v_subject, v_date, v_start, v_end, v_ids, v_label, v_cap, a.user_id)
      returning * into v_s;
  end if;
  insert into public.makeup_participants (tenant_id, session_id, student_id, subject_key, session_date, planned_minutes, anchor_class_id)
    values (a.tenant_id, v_s.id, p_student, v_subject, v_date, v_minutes, v_anchor) returning id into v_part;
  if v_rep.id is not null and v_anchor is not null then
    insert into public.makeup_reservations (tenant_id, student_id, class_id, absence_date, makeup_date, slot_start,
        slot_end, period_label, note, created_by)
      values (a.tenant_id, p_student, v_anchor, v_rep.original_date, v_date, v_start, v_end, v_label, left(p_note, 300), a.user_id)
      returning id, to_jsonb(makeup_reservations.*) - 'updated_at' into v_legacy, v_snap;
  end if;
  for v_c in select c.* from public.makeup_cases c where c.id = any (v_case_ids) order by c.id loop
    select makeup_private.p_int(x, 'minutes') into v_minutes
      from jsonb_array_elements(p_allocs) x where makeup_private.p_uuid(x, 'case_id') = v_c.id;
    insert into public.makeup_allocations (tenant_id, case_id, participant_id, student_id, subject_key, allocated_minutes, created_by)
      values (a.tenant_id, v_c.id, v_part, p_student, v_subject, v_minutes, a.user_id) returning id into v_alloc;
    perform makeup_private.recompute_case(v_c.id);
    if v_legacy is not null then
      insert into public.makeup_legacy_maps (tenant_id, legacy_kind, legacy_id, case_id, participant_id, allocation_id,
          direction, snapshot, checksum, native_effect_key)
        values (a.tenant_id, 'reservation', v_legacy, v_c.id, v_part, v_alloc, 'projected', v_snap, md5(v_snap::text), 'resv:' || v_part::text);
    end if;
    perform makeup_private.log_event(a.tenant_id, 'allocation', v_alloc, p_event, a.user_id, p_cmd, v_c.id, v_s.id, p_note,
      jsonb_build_object('participant_id', v_part, 'minutes', v_minutes, 'session_date', v_date,
        'start_time', to_char(v_start, 'HH24:MI'), 'end_time', to_char(v_end, 'HH24:MI'),
        'teacher_id', v_teacher, 'classroom_id', v_room, 'legacy_reservation_id', v_legacy));
  end loop;
  if v_anchor is null then
    perform makeup_private.open_recon(a.tenant_id, 'anchor_missing', 'anchor:' || v_part::text, false, v_case_ids[1],
      v_part, v_s.id, null, null, jsonb_build_object('student_id', p_student, 'session_date', v_date));
  end if;
  return v_part;
end;
$$;

revoke all on all functions in schema makeup_private from public, anon, authenticated;
