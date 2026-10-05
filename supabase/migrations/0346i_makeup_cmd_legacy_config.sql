-- 0346i — 명령: 기존 예약 연결(link_legacy)  (설정 configure는 0346l)
--
-- link_legacy — 출석부에 이미 잡혀 있는 예약(0264a) 한 건을 원장에 연결한다.
--   · 기존 약속은 **일정 그대로 보존**한다(회차·참여·배정으로 옮겨 적고 imported 표시). 새 권리를 자동으로
--     발급하지 않는다: 케이스는 pending(목표 분량 없음) + imported_commitment. 승인은 사람이 따로 한다.
--   · 이미 done인 예약도 "검토 완료"로 올리지 않는다 — 참여는 미기록으로 두고 검토 대사(legacy_done_review)를 연다.
--   · 같은 학생·과목·날짜에 이미 살아 있는 참여가 있으면 강제로 합치지 않는다 — 예약은 그대로 두고 검토 큐로 보낸다.
--   · 다시 실행해도 늘지 않는다: 같은 예약·같은 내용이면 no-op. 원본이 바뀌어 있으면 no-op이 아니라 재검토 대사.
--   · 연결된 예약 행은 그때부터 직접 수정·삭제가 막힌다(0349a). 꺼짐(off) 뒤에도 유지되는 보호다.
--   · payload: source_id(= 예약 id) · expected_source_hash(선택 — 미리 보기의 source_hash. 다르면 쓰기 전에 거절) · batch_id(선택).
-- 멱등: create or replace.

create or replace function makeup_private.cmd_link_legacy(a makeup_private.actor_ctx, p_cmd uuid, p jsonb, p_rev integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_rid uuid := coalesce(makeup_private.p_uuid(p, 'source_id'), makeup_private.p_uuid(p, 'legacy_reservation_id'));
  v_r public.makeup_reservations%rowtype;
  v_subject text;
  v_snap jsonb;
  v_sum text;
  v_key text;
  v_map public.makeup_legacy_maps%rowtype;
  v_c public.makeup_cases%rowtype;
  v_minutes integer;
  v_session uuid; v_part uuid; v_alloc uuid; v_other uuid;
begin
  perform makeup_private.require_level(a, 'wide');
  -- 예약 행을 잠그고 읽는다 — 아래 체크섬 대조와 연결 사이에 내용이 바뀌지 않는다.
  select * into v_r from public.makeup_reservations r where r.id = v_rid and r.tenant_id = a.tenant_id for update;
  if not found then perform makeup_private.fail('not_found', '보강 예약을 찾을 수 없습니다'); end if;
  -- 🔴 예약 표의 FK는 id만 본다(지점을 묶지 않는다) — 학생·반이 **이 지점의 것**인지 여기서 확인한다. 다른 지점의 학생·반을
  --    가리키는 예약(오래된 데이터·조작)은 원장에 들이지 않는다. 연결된 출결 행도 그 학생·반·보강일의 것이어야 한다.
  select c.subject into v_subject from public.classes c where c.id = v_r.class_id and c.tenant_id = a.tenant_id;
  if v_subject is null or not exists (select 1 from public.students s where s.id = v_r.student_id and s.tenant_id = a.tenant_id) then
    perform makeup_private.fail('invalid', '이 예약의 학생이나 반을 이 학원에서 찾을 수 없습니다 — 예약 내용을 먼저 확인해 주세요',
      jsonb_build_object('reason', 'source_reference'));
  end if;
  if not (v_subject = any (a.pilot_subjects)) then
    perform makeup_private.fail('invalid', '이 과목은 아직 보강관리에서 다루지 않습니다');
  end if;
  if v_r.attendance_record_id is not null and not exists (
       select 1 from public.attendance_records ar
        where ar.id = v_r.attendance_record_id and ar.tenant_id = a.tenant_id and ar.student_id = v_r.student_id
          and ar.class_id = v_r.class_id and ar.session_date = v_r.makeup_date) then
    perform makeup_private.fail('invalid', '예약에 연결된 출결 기록이 이 학생·반·보강일의 것이 아닙니다 — 출석부에서 먼저 확인해 주세요',
      jsonb_build_object('reason', 'source_attendance'));
  end if;
  v_snap := to_jsonb(v_r) - 'updated_at';
  v_sum := md5(v_snap::text);
  -- 미리 보기(0348i)에서 본 내용 그대로일 때만 연결한다 — 그 사이 예약이 바뀌었으면 **아무것도 쓰기 전에** 거절한다.
  if makeup_private.p_text(p, 'expected_source_hash') is not null and makeup_private.p_text(p, 'expected_source_hash') <> v_sum then
    perform makeup_private.fail('conflict', '미리 확인한 뒤에 예약 내용이 바뀌었습니다 — 다시 확인한 뒤 연결해 주세요',
      jsonb_build_object('reason', 'source_changed', 'current_source_hash', v_sum));
  end if;
  v_key := 'day:' || v_r.student_id::text || ':' || v_r.class_id::text || ':' || to_char(v_r.absence_date, 'YYYY-MM-DD');
  perform makeup_private.lock_keys(a.tenant_id,
    array['occ:' || v_key, 'stu:' || v_r.student_id::text || ':' || v_r.makeup_date::text]);

  select * into v_map from public.makeup_legacy_maps m
   where m.tenant_id = a.tenant_id and m.legacy_kind = 'reservation' and m.legacy_id = v_rid and m.state = 'active' limit 1;
  if found then
    if v_map.checksum <> v_sum then
      perform makeup_private.open_recon(a.tenant_id, 'legacy_checksum_conflict', 'legacy_checksum:' || v_rid::text || ':' || v_sum,
        false, v_map.case_id, v_map.participant_id, null, null, v_rid, jsonb_build_object('linked', v_map.snapshot, 'current', v_snap));
    end if;
    return makeup_private.result('link_legacy', v_map.case_id, (select c.revision from public.makeup_cases c where c.id = v_map.case_id),
      'legacy:' || v_rid::text, array[v_map.case_id],
      jsonb_build_object('existing', true, 'participant_id', v_map.participant_id,
        'warnings', case when v_map.checksum <> v_sum then '["legacy_checksum_conflict"]'::jsonb else '[]'::jsonb end));
  end if;

  select * into v_c from public.makeup_cases c where c.tenant_id = a.tenant_id and c.occurrence_key = v_key for update;
  if not found then
    insert into public.makeup_cases (tenant_id, student_id, subject_key, original_class_id, original_date, occurrence_key,
        reason, note, absence_planned, imported_commitment, created_by)
      values (a.tenant_id, v_r.student_id, v_subject, v_r.class_id, v_r.absence_date, v_key, 'imported',
        left(v_r.note, 1000), v_r.absence_date > a.today, true, a.user_id)
      returning * into v_c;
  elsif v_c.lifecycle = 'closed' then
    perform makeup_private.fail('conflict', '이미 종결한 보강 건의 예약입니다 — 종결한 건을 먼저 확인해 주세요');
  end if;
  insert into public.makeup_case_sources (tenant_id, case_id, source_kind, source_id, snapshot, source_hash, created_by)
    values (a.tenant_id, v_c.id, 'reservation', v_rid::text, v_snap, v_sum, a.user_id)
    on conflict (tenant_id, source_kind, source_id) do nothing;

  -- 그날 그 과목에 이미 살아 있는 참여가 있으면 합치지 않고 검토 큐로(예약 행은 종전대로 남는다).
  select x.id into v_other from public.makeup_participants x
   where x.tenant_id = a.tenant_id and x.student_id = v_r.student_id and x.subject_key = v_subject
     and x.session_date = v_r.makeup_date and x.status <> 'cancelled';
  if v_other is not null then
    perform makeup_private.open_recon(a.tenant_id, 'legacy_multi_same_day', 'legacy_multi:' || v_rid::text, false,
      v_c.id, v_other, null, null, v_rid, v_snap);
    return makeup_private.result('link_legacy', v_c.id, v_c.revision, 'legacy:' || v_rid::text, array[v_c.id],
      jsonb_build_object('existing', false, 'warnings', '["legacy_multi_same_day"]'::jsonb));
  end if;

  v_minutes := least(greatest((extract(epoch from (v_r.slot_end - v_r.slot_start)) / 60)::integer, 1), 600);
  if v_c.eligibility = 'approved' and v_minutes > v_c.outstanding_minutes - v_c.committed_minutes then
    perform makeup_private.fail('conflict', '남은 분량보다 기존 예약이 깁니다 — 분량을 조정한 뒤 연결해 주세요');
  end if;
  insert into public.makeup_sessions (tenant_id, subject_key, session_date, start_time, end_time, period_label, imported, created_by)
    values (a.tenant_id, v_subject, v_r.makeup_date, v_r.slot_start, v_r.slot_end, v_r.period_label, true, a.user_id)
    returning id into v_session;
  insert into public.makeup_participants (tenant_id, session_id, student_id, subject_key, session_date, planned_minutes,
      anchor_class_id, attendance_record_id)
    values (a.tenant_id, v_session, v_r.student_id, v_subject, v_r.makeup_date, v_minutes, v_r.class_id, v_r.attendance_record_id)
    returning id into v_part;
  insert into public.makeup_allocations (tenant_id, case_id, participant_id, student_id, subject_key, allocated_minutes, created_by)
    values (a.tenant_id, v_c.id, v_part, v_r.student_id, v_subject, v_minutes, a.user_id) returning id into v_alloc;
  insert into public.makeup_legacy_maps (tenant_id, legacy_kind, legacy_id, case_id, participant_id, allocation_id, direction,
      snapshot, checksum, native_effect_key, batch_id)
    values (a.tenant_id, 'reservation', v_rid, v_c.id, v_part, v_alloc, 'imported', v_snap, v_sum, 'resv:' || v_part::text,
      makeup_private.p_uuid(p, 'batch_id'));
  perform makeup_private.recompute_case(v_c.id);
  if v_r.status = 'done' then
    perform makeup_private.open_recon(a.tenant_id, 'legacy_done_review', 'legacy_done:' || v_rid::text, false, v_c.id, v_part,
      v_session, v_r.attendance_record_id, v_rid, jsonb_build_object('done_at', v_r.done_at));
  end if;
  perform makeup_private.log_event(a.tenant_id, 'legacy', v_rid, 'legacy_linked', a.user_id, p_cmd, v_c.id, v_session, null,
    jsonb_build_object('participant_id', v_part, 'minutes', v_minutes, 'legacy_status', v_r.status, 'checksum', v_sum));
  perform makeup_private.audit(a, 'link_legacy', '기존 보강 예약 연결', jsonb_build_object('command_id', p_cmd, 'case_id', v_c.id));
  return makeup_private.result('link_legacy', v_c.id, (select c.revision from public.makeup_cases c where c.id = v_c.id),
    'legacy:' || v_rid::text, array[v_c.id],
    jsonb_build_object('existing', false, 'participant_id', v_part, 'session_id', v_session));
end;
$$;

revoke all on all functions in schema makeup_private from public, anon, authenticated;
