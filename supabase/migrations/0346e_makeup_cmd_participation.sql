-- 0346e — 명령: 실제 참여 입력(participation)
--
-- 학생별로 왔다(present) · 일부만 했다(partial) · 안 왔다(no_show)를 사람이 기록한다. 시간이 지났다고 자동으로
-- 노쇼·완료가 되지 않는다. 회차는 남은 학생이 전부 기록되면 finished(전원 노쇼면 all_no_show)다.
-- 🔴 실제 분은 **반드시 명시**한다 — 예정 분으로 채우지 않는다.
-- 🔴 왔다/일부는 **실시 증거**가 있어야 한다(없으면 evidence_required). 정규 수업일의 출석은 증거가 아니다:
--      report     report_id — 반 없는 보강 보고서 · 실제 강사 작성 · 앵커 반 일치 · 발송 처리 중 아님(0345d assert_report)
--      manual     learning_summary — 명시한 분 + 지도 근거 글(그 회차의 강사 또는 지점 전체 운영 권한이 확인)
--      attendance attendance_record_id — **정규 수업이 없는 날**의 앵커 반 출결 행(출결 저장 훅의 자동 이행 경로)
--    출결 행을 함께 주면 증거와 별개로 지금 값(최신 유효 행·귀속 강사·교시)을 검사해 연결한다.
-- 🔴 출결 관측과 실제 참여는 다르다: 참여·실제 분·예약 행 이행은 이 명령이 증거와 함께 올 때만 바뀐다. 출결 효과(시수·귀속)는
--    0345e의 한 helper가 검증한다 — 맞으면 연결 + 반영 작업 done, 어긋나면 failed + 대사(종결·인정 검토 차단).
--   · 노쇼: 같은 명령 안에서 그 학생의 살아 있는 배정을 자동 해제한다. 의무(O)는 그대로라 다시 잡을 수 있다.
--   · 노쇼를 잘못 눌렀으면 되돌릴 수 있지만 자리·시간·예약 가능량을 **다시 검사**한다(0345e restore_no_show).
-- 🔴 이 명령은 출결 행·시수·보고서를 쓰지 않는다. 입력한 사람(대리입력이면 데스크)과 실제 강사(회차의 강사)는 다른 칸에 남는다.
-- 멱등: create or replace.

create or replace function makeup_private.cmd_participation(a makeup_private.actor_ctx, p_cmd uuid, p jsonb, p_rev integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid := makeup_private.p_uuid(p, 'participant_id');
  v_status text := makeup_private.p_text(p, 'status');
  v_actual integer := makeup_private.p_int(p, 'actual_minutes');
  v_att uuid := makeup_private.p_uuid(p, 'attendance_record_id');
  v_report uuid := makeup_private.p_uuid(p, 'report_id');
  v_summary text := left(coalesce(makeup_private.p_text(p, 'learning_summary'), makeup_private.p_text(p, 'evidence_note')), 2000);
  v_note text := coalesce(makeup_private.p_text(p, 'note'), makeup_private.p_text(p, 'reason'));
  v_p public.makeup_participants%rowtype;
  v_s public.makeup_sessions%rowtype;
  v_cases uuid[];
  v_prev text;
  v_restore boolean;
  v_kind text;
  v_issue text;
  v_ful uuid;
  v_eff jsonb;
  v_case uuid;
begin
  perform makeup_private.require_level(a, 'write');
  select * into v_p from public.makeup_participants x where x.id = v_id and x.tenant_id = a.tenant_id;
  if not found then perform makeup_private.fail('not_found', '보강 일정을 찾을 수 없습니다'); end if;
  select * into v_s from public.makeup_sessions s where s.id = v_p.session_id;
  if not a.wide and v_s.teacher_id is distinct from a.user_id then
    perform makeup_private.fail('forbidden', '본인이 맡은 보강의 참여만 기록할 수 있습니다');
  end if;
  if v_status is null or v_status not in ('present', 'partial', 'no_show') then
    perform makeup_private.fail('invalid', '참여 상태를 골라 주세요');
  end if;
  -- 노쇼 되돌리기는 자리를 다시 잡는 일이다 → 문·학생-날짜 잠금을 케이스 잠금보다 먼저(0345a 순서).
  v_restore := v_p.status = 'no_show' and v_status <> 'no_show';
  if v_restore then
    perform makeup_private.lock_keys(a.tenant_id, array['gate', 'stu:' || v_p.student_id::text || ':' || v_p.session_date::text]);
  end if;
  select array_agg(al.case_id order by al.case_id) into v_cases from public.makeup_allocations al where al.participant_id = v_id;
  perform makeup_private.lock_cases(a.tenant_id, coalesce(v_cases, '{}'::uuid[]));
  select * into v_s from public.makeup_sessions s where s.id = v_p.session_id for update;
  select * into v_p from public.makeup_participants x where x.id = v_id for update;
  perform makeup_private.check_revision(p_rev, v_p.revision, false);
  if (v_p.status = 'no_show' and v_status <> 'no_show') is distinct from v_restore then
    perform makeup_private.check_revision(-1, v_p.revision);
  end if;
  -- 기존 예약에서 온 회차는 실제 강사가 비어 있다 — 지점 전체 운영 권한이 참여를 기록하면서 지정한다.
  if v_s.teacher_id is null then
    if not a.wide or makeup_private.p_uuid(p, 'teacher_id') is null then
      perform makeup_private.fail('invalid', '이 일정은 실제로 가르친 강사를 지정해야 기록할 수 있습니다 — 관리자에게 요청해 주세요');
    end if;
    perform makeup_private.assert_staff(a.tenant_id, makeup_private.p_uuid(p, 'teacher_id'));
    update public.makeup_sessions s set teacher_id = makeup_private.p_uuid(p, 'teacher_id') where s.id = v_s.id returning * into v_s;
  end if;
  if (p ? 'student_id' and makeup_private.p_uuid(p, 'student_id') is distinct from v_p.student_id)
     or (p ? 'subject_key' and makeup_private.p_text(p, 'subject_key') is distinct from v_p.subject_key)
     or (p ? 'session_date' and makeup_private.p_date(p, 'session_date') is distinct from v_p.session_date)
     or (makeup_private.p_uuid(p, 'teacher_id') is not null and makeup_private.p_uuid(p, 'teacher_id') is distinct from v_s.teacher_id)
     or (makeup_private.p_uuid(p, 'class_id') is not null
         and makeup_private.p_uuid(p, 'class_id') is distinct from coalesce(v_p.anchor_class_id, v_s.class_id)) then
    perform makeup_private.fail('invalid', '보강 일정 정보가 서로 맞지 않습니다 — 새로 고친 뒤 다시 기록해 주세요');
  end if;
  if v_p.status = 'cancelled' or v_s.state not in ('confirmed', 'finished') then
    perform makeup_private.fail('conflict', '취소되었거나 바뀐 일정입니다 — 새로 고쳐 확인해 주세요');
  end if;
  if v_s.session_date > a.today then
    perform makeup_private.fail('conflict', '아직 오지 않은 날짜의 참여는 기록할 수 없습니다');
  end if;
  if exists (select 1 from public.makeup_fulfillments f where f.participant_id = v_id and f.state = 'verified') then
    perform makeup_private.fail('conflict', '검토를 마친 기록입니다 — 정정은 관리자에게 요청해 주세요');
  end if;
  if v_status = 'no_show' then
    v_actual := 0;
  elsif v_actual is null or v_actual not between 1 and 600 or (v_status = 'partial' and v_actual >= v_p.planned_minutes) then
    perform makeup_private.fail('invalid', '실제로 지도한 분량을 분 단위로 넣어 주세요 — 일부 참여는 예정 분량보다 적어야 합니다');
  end if;
  if v_att is not null then
    v_issue := makeup_private.attendance_issue(a.tenant_id, v_att, v_p, v_s.teacher_id, v_s.start_time, v_s.end_time, v_status);
    if v_issue is not null then
      perform makeup_private.fail('invalid', makeup_private.attendance_issue_text(v_issue), jsonb_build_object('reason', v_issue));
    end if;
  end if;
  if v_status <> 'no_show' then
    perform makeup_private.assert_report(a.tenant_id, v_report, v_p, v_s.teacher_id);
    v_kind := case when v_report is not null then 'report' when v_summary is not null then 'manual'
                   when v_att is not null and not makeup_private.is_regular_day(a.tenant_id, v_p.student_id, v_p.anchor_class_id, v_p.session_date)
                     then 'attendance'
                   -- 분만 고쳐 다시 기록할 때: 이미 남겨 둔 보고서·지도 근거는 그대로 증거다.
                   else (select case when f.report_id is not null then 'report' else 'manual' end from public.makeup_fulfillments f
                          where f.participant_id = v_id and f.state <> 'reversed' and (f.report_id is not null or f.learning_summary is not null)) end;
    if v_kind is null then
      perform makeup_private.fail('evidence_required', '정규 수업 출석만으로는 보강 실시를 기록할 수 없습니다 — 실제 지도 분량과 함께 보강 보고서나 지도 내용을 넣어 주세요');
    end if;
  end if;

  v_prev := v_p.status;
  if v_status = 'no_show' and v_prev <> 'no_show' then
    perform makeup_private.release_participant(a, p_cmd, v_id, 'no_show', false, v_note);
    update public.makeup_fulfillments f set state = 'reversed', reverse_reason = '안 온 것으로 정정'
     where f.participant_id = v_id and f.state <> 'reversed';
  elsif v_restore then
    perform makeup_private.restore_no_show(a, v_id);
  end if;
  update public.makeup_participants x
     set status = v_status, actual_minutes = v_actual, attendance_record_id = coalesce(v_att, x.attendance_record_id),
         recorded_by = a.user_id, recorded_at = now()
   where x.id = v_id returning * into v_p;

  if v_status <> 'no_show' then
    select f.id into v_ful from public.makeup_fulfillments f where f.participant_id = v_id and f.state <> 'reversed';
    if v_ful is null then
      insert into public.makeup_fulfillments (tenant_id, participant_id, version, attendance_record_id, report_id, evidence_kind,
          learning_summary, actual_minutes, actual_teacher_id, recorded_by, effect_key)
        select a.tenant_id, v_id, coalesce(max(f.version), 0) + 1, v_p.attendance_record_id, v_report, v_kind, v_summary, v_actual,
               v_s.teacher_id, a.user_id, 'ful:' || v_id::text || ':v' || (coalesce(max(f.version), 0) + 1)::text
          from public.makeup_fulfillments f where f.participant_id = v_id
        returning id into v_ful;
    else
      update public.makeup_fulfillments f
         set actual_minutes = v_actual, attendance_record_id = v_p.attendance_record_id, evidence_kind = v_kind,
             report_id = coalesce(v_report, f.report_id), learning_summary = coalesce(v_summary, f.learning_summary),
             actual_teacher_id = v_s.teacher_id, recorded_by = a.user_id
       where f.id = v_ful;
    end if;
    -- 출결 화면용 예약 행은 이 참여 것만 이행으로 넘긴다(형제 예약은 건드리지 않는다). 연결 스냅샷도 같이 맞춘다.
    update public.makeup_reservations r set status = 'done', done_at = now(), attendance_record_id = v_p.attendance_record_id
     where r.id in (select m.legacy_id from public.makeup_legacy_maps m where m.participant_id = v_id and m.state = 'active');
    update public.makeup_legacy_maps m
       set snapshot = to_jsonb(r) - 'updated_at', checksum = md5((to_jsonb(r) - 'updated_at')::text), target_revision = m.target_revision + 1
      from public.makeup_reservations r
     where m.participant_id = v_id and m.state = 'active' and r.id = m.legacy_id;
    perform makeup_private.note_billing_review(a, v_id);
  end if;
  -- 출결 효과: 한 helper가 지금 값으로 검증한다(클라이언트가 보낸 예상 시수는 주장값으로만 남긴다).
  v_eff := makeup_private.sync_attendance_effect(a.tenant_id, v_id, a.user_id, true, jsonb_build_object(
    'manual_units', p -> 'manual_units', 'expected_makeup_units', p -> 'expected_makeup_units', 'expected_total_units', p -> 'expected_total_units'));

  if not exists (select 1 from public.makeup_participants x where x.session_id = v_s.id and x.status = 'unknown') then
    update public.makeup_sessions s
       set state = 'finished',
           finish_reason = case when not exists (select 1 from public.makeup_participants x
                                                  where x.session_id = s.id and x.status in ('present', 'partial'))
                                then 'all_no_show' end
     where s.id = v_s.id and (s.state <> 'finished' or v_prev <> v_status);
  end if;
  foreach v_case in array coalesce(v_cases, '{}'::uuid[]) loop
    perform makeup_private.log_event(a.tenant_id, 'participant', v_id, 'participation_recorded', a.user_id, p_cmd, v_case, v_s.id, v_note,
      jsonb_build_object('status', v_status, 'previous_status', v_prev, 'actual_minutes', v_actual, 'evidence_kind', v_kind,
        'attendance_record_id', v_p.attendance_record_id, 'report_id', v_report, 'actual_teacher_id', v_s.teacher_id,
        'proxy', a.user_id is distinct from v_s.teacher_id, 'projection_state', v_eff -> 'projection_state'));
  end loop;
  select * into v_p from public.makeup_participants x where x.id = v_id;
  return makeup_private.result('participation', v_id, v_p.revision, 'att:' || v_id::text, coalesce(v_cases, '{}'::uuid[]),
    jsonb_build_object('participant_id', v_id, 'session_id', v_s.id, 'fulfillment_id', v_ful, 'status', v_status,
      'evidence_kind', v_kind, 'projection_state', v_eff -> 'projection_state', 'verification', v_eff -> 'verification',
      'evidence', makeup_private.evidence_json(a.tenant_id, v_id)));
end;
$$;

revoke all on all functions in schema makeup_private from public, anon, authenticated;
