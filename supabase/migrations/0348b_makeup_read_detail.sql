-- 0348b — 읽기 RPC 2/3: 보강 상세 public.makeup_case_detail
--
-- 한 건의 원근거 → 예정 회차 → 실제 참여·실시 기록 → 인정·조정 → 변경 이력 → 확인 필요 항목을 한 번에 돌려준다.
-- 범위 밖 건은 "없음"과 같은 오류로 거절한다(있는지조차 알려 주지 않는다). 꺼짐(off)이면 예외.
-- 반환: {mode, case{…}, policy, quantities, sources[], sessions[], participants[], allocations[], fulfillments[],
--        recognitions[], adjustments[], events[](최근 50 — 전부는 makeup_case_events로 넘겨 읽는다), events_total,
--        reconciliation[], projection_jobs[], legacy_maps[], permissions{행동: 지금 이 계정이 이 건에 할 수 있는가}}
--   reconciliation · projection_jobs는 이 건에 **닿는** 항목 전부다(0344c — 회차 단위·1:N 연결 포함, 종결 차단과 같은 판정).
--   permissions는 화면이 버튼을 고르는 힌트다 — 실제 판정은 명령이 다시 한다(#77).
-- 🔴 보호자 연락처·수납·상담 자료는 싣지 않는다(배정된 학습 기록 범위 밖).
-- 멱등: create or replace.

create or replace function public.makeup_case_detail(p_case_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  a makeup_private.actor_ctx := makeup_private.actor();
  v_row jsonb;
  v_c public.makeup_cases%rowtype;
  v_parts uuid[];
  v_sessions uuid[];
  v_live boolean;
  v_can_write boolean := a.access <> 'readonly';
begin
  perform makeup_private.require_mode(a, 'read');
  select to_jsonb(r) into v_row from makeup_private.case_rows(a, p_case_id) r;
  if v_row is null then
    perform makeup_private.fail('not_found', '보강 건을 찾을 수 없습니다');
  end if;
  select * into v_c from public.makeup_cases c where c.id = p_case_id;
  select coalesce(array_agg(distinct al.participant_id), '{}'::uuid[]) into v_parts
    from public.makeup_allocations al where al.case_id = p_case_id;
  select coalesce(array_agg(distinct p.session_id), '{}'::uuid[]) into v_sessions
    from public.makeup_participants p where p.id = any (v_parts);
  v_live := exists (select 1 from public.makeup_participants p where p.id = any (v_parts) and p.status = 'unknown');

  return jsonb_build_object(
    'mode', a.mode,
    'case', v_row || jsonb_build_object(
      'note', v_c.note, 'policy_version_id', v_c.policy_version_id, 'adjusted_minutes', v_c.adjusted_minutes,
      'recognized_minutes', v_c.recognized_minutes, 'waived_minutes', v_c.waived_minutes, 'hold_reason', v_c.hold_reason,
      'hold_review_at', v_c.hold_review_at, 'merged_into', v_c.merged_into, 'absence_planned', v_c.absence_planned,
      'occurrence_key', v_c.occurrence_key, 'unit_kind', v_c.unit_kind, 'closed_at', v_c.closed_at, 'created_at', v_c.created_at),
    'policy', (select to_jsonb(pv) - 'tenant_id' from public.makeup_policy_versions pv where pv.id = v_c.policy_version_id),
    'quantities', makeup_private.quantities(p_case_id),
    'sources', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'source_kind', s.source_kind, 'source_id', s.source_id,
        'evidence', s.evidence, 'snapshot', s.snapshot, 'source_hash', s.source_hash, 'created_at', s.created_at) order by s.created_at)
      from public.makeup_case_sources s where s.case_id = p_case_id), '[]'::jsonb),
    'sessions', coalesce((select jsonb_agg(makeup_private.session_json(s.id) order by s.session_date, s.start_time)
      from public.makeup_sessions s where s.id = any (v_sessions)), '[]'::jsonb),
    'participants', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'revision', p.revision, 'session_id', p.session_id,
        'student_id', p.student_id, 'session_date', p.session_date, 'status', p.status, 'planned_minutes', p.planned_minutes,
        'actual_minutes', p.actual_minutes, 'anchor_class_id', p.anchor_class_id, 'attendance_record_id', p.attendance_record_id,
        'expected_makeup_units', p.expected_makeup_units, 'cancel_reason', p.cancel_reason, 'recorded_by', p.recorded_by,
        'recorded_at', p.recorded_at) order by p.session_date, p.created_at)
      from public.makeup_participants p where p.id = any (v_parts)), '[]'::jsonb),
    -- 같은 참여에 걸린 다른 케이스의 배정도 함께 준다(한 참여의 인정 합을 보려면 필요하다) — 같은 학생의 건이고,
    -- 그 건이 행위자 범위 안일 때만이다(범위 밖 건의 번호·원수업일은 싣지 않는다).
    'allocations', coalesce((select jsonb_agg(jsonb_build_object('id', al.id, 'revision', al.revision, 'case_id', al.case_id,
        'participant_id', al.participant_id, 'allocated_minutes', al.allocated_minutes,
        'recognized_minutes', al.recognized_minutes, 'released_minutes', al.released_minutes,
        'live_minutes', al.allocated_minutes - al.recognized_minutes - al.released_minutes,
        'release_reason', al.release_reason,
        'original_date', (select c.original_date from public.makeup_cases c where c.id = al.case_id)) order by al.created_at)
      from public.makeup_allocations al
     where al.participant_id = any (v_parts) and (al.case_id = p_case_id or makeup_private.can_read_all(a) or makeup_private.in_scope(a, al.case_id))), '[]'::jsonb),
    'fulfillments', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'revision', f.revision,
        'participant_id', f.participant_id, 'version', f.version, 'state', f.state, 'report_id', f.report_id,
        'attendance_record_id', f.attendance_record_id, 'actual_minutes', f.actual_minutes,
        'actual_teacher_id', f.actual_teacher_id, 'recorded_by', f.recorded_by, 'submitted_by', f.submitted_by,
        'submitted_at', f.submitted_at, 'verified_by', f.verified_by, 'verified_at', f.verified_at,
        'learning_summary', f.learning_summary, 'homework', f.homework, 'return_reason', f.return_reason,
        'reverse_reason', f.reverse_reason) order by f.created_at)
      from public.makeup_fulfillments f where f.participant_id = any (v_parts)), '[]'::jsonb),
    'recognitions', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'fulfillment_id', r.fulfillment_id,
        'allocation_id', r.allocation_id, 'case_id', r.case_id, 'kind', r.kind, 'minutes', r.minutes,
        'reversal_of', r.reversal_of, 'reason', r.reason, 'decided_by', r.decided_by, 'created_at', r.created_at) order by r.created_at)
      from public.makeup_recognitions r where r.case_id = p_case_id), '[]'::jsonb),
    'adjustments', coalesce((select jsonb_agg(jsonb_build_object('id', j.id, 'kind', j.kind, 'minutes', j.minutes,
        'due_date_from', j.due_date_from, 'due_date_to', j.due_date_to, 'reason', j.reason, 'decided_by', j.decided_by,
        'created_at', j.created_at) order by j.created_at)
      from public.makeup_adjustments j where j.case_id = p_case_id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(to_jsonb(e) order by e.occurred_at desc, e.id) from (
        select ev.id, ev.entity_type, ev.entity_id, ev.event_type, ev.actor_id,
               (select u.display_name from public.users u where u.id = ev.actor_id) as actor_name,
               ev.command_id, ev.session_id, ev.reason, makeup_private.scrub_json(a, ev.data) as data, ev.from_revision,
               ev.to_revision, ev.occurred_at
          from public.makeup_events ev
         where ev.tenant_id = a.tenant_id and (ev.case_id = p_case_id or ev.session_id = any (v_sessions))
           and (ev.case_id is null or ev.case_id = p_case_id)
         order by ev.occurred_at desc, ev.id limit 50) e), '[]'::jsonb),
    'events_total', (select count(*) from public.makeup_events ev
                      where ev.tenant_id = a.tenant_id and (ev.case_id = p_case_id or ev.session_id = any (v_sessions))
                        and (ev.case_id is null or ev.case_id = p_case_id)),
    -- 대사·반영 작업은 표의 행을 그대로 내보내지 않는다(0348h): 범위 밖 번호를 지우고, 수납 정보는 수납 읽기 권한에만.
    'reconciliation', coalesce((select jsonb_agg(makeup_private.recon_public(a, r) order by r.created_at desc)
      from public.makeup_reconciliation r
      where r.tenant_id = a.tenant_id and makeup_private.recon_touches(r, p_case_id)), '[]'::jsonb),
    'projection_jobs', coalesce((select jsonb_agg(makeup_private.job_public(a, j) order by j.created_at desc)
      from public.makeup_projection_jobs j
      where j.tenant_id = a.tenant_id and makeup_private.job_touches(j, p_case_id)), '[]'::jsonb),
    'legacy_maps', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'legacy_reservation_id', m.legacy_id,
        'participant_id', m.participant_id, 'case_id', m.case_id, 'direction', m.direction, 'state', m.state,
        'effect_key', m.native_effect_key, 'snapshot', m.snapshot) order by m.created_at)
      from public.makeup_legacy_maps m where m.case_id = p_case_id), '[]'::jsonb),
    'permissions', jsonb_build_object(
      'intake', v_can_write and a.mode = 'on',
      'approve', a.privileged and v_c.lifecycle <> 'closed' and v_c.eligibility = 'pending',
      'deny', a.privileged and v_c.lifecycle <> 'closed' and v_c.eligibility = 'pending',
      'assign', a.wide and v_c.lifecycle <> 'closed',
      'reserve', v_can_write and a.mode = 'on' and v_c.lifecycle = 'open' and v_c.eligibility = 'approved'
                 and v_c.outstanding_minutes - v_c.committed_minutes > 0,
      'reschedule', v_can_write and a.mode = 'on' and v_live,
      'cancel', v_can_write and v_live,
      'participation', v_can_write and exists (
        select 1 from public.makeup_participants p join public.makeup_sessions s on s.id = p.session_id
         where p.id = any (v_parts) and p.status <> 'cancelled' and s.session_date <= a.today
           and (a.wide or s.teacher_id = a.user_id)
           and not exists (select 1 from public.makeup_fulfillments f where f.participant_id = p.id and f.state = 'verified')),
      'submit', v_can_write and exists (
        select 1 from public.makeup_fulfillments f join public.makeup_participants p on p.id = f.participant_id
          join public.makeup_sessions s on s.id = p.session_id
         where p.id = any (v_parts) and f.state in ('draft', 'returned') and (a.wide or s.teacher_id = a.user_id)),
      'verify', a.privileged and exists (
        select 1 from public.makeup_fulfillments f where f.participant_id = any (v_parts) and f.state = 'submitted'),
      'reverse', a.privileged and exists (
        select 1 from public.makeup_fulfillments f where f.participant_id = any (v_parts) and f.state = 'verified'),
      'waive', a.privileged and v_c.lifecycle <> 'closed' and v_c.eligibility = 'approved',
      'adjust', a.privileged and v_c.lifecycle <> 'closed' and v_c.eligibility = 'approved',
      'hold', a.wide and v_c.lifecycle = 'open',
      'resume', a.wide and v_c.lifecycle = 'on_hold',
      'resolve_reconciliation', a.wide, 'reconcile', a.wide, 'accept_manual_units', a.privileged,
      'read_billing', makeup_private.can_read_billing(),
      'close', a.privileged and v_c.lifecycle <> 'closed'));
end;
$$;

revoke all on function public.makeup_case_detail(uuid) from public, anon, service_role;
grant execute on function public.makeup_case_detail(uuid) to authenticated;
notify pgrst, 'reload schema';
