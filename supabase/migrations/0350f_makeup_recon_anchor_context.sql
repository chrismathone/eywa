-- 0350f — 대사 항목의 화면용 출력(recon_public): 출결 반 확인 항목에 반 후보를 찾을 재료를 싣는다
--
-- 0348h의 recon_public을 바꿔 끼운다(같은 파일의 scrub_json · job_public은 그대로다). 칸 하나만 더한다.
--   anchor_context {student_id, subject_key, session_date}
--     출결 반 확인(anchor_missing) 항목에만 온다. 화면이 반 후보를 고를 때(makeup_options · purpose = 'anchor') 그대로 넘기는 값이다.
--     · 그 참여의 **지금 값**에서 읽는다(대사를 열 때 적어 둔 detail이 아니라 참여 행 — 과목은 detail에 없다).
--     · 그 참여가 이 계정의 범위 안일 때만 싣는다(범위 밖 참여의 학생·날짜를 내보내지 않는다 — participant_id와 같은 규칙).
--     · 다른 종류의 항목 · 수납 읽기 권한이 없어 가려진 항목에는 싣지 않는다.
-- 대사 목록(0348g)과 보강 상세(0350b)가 같은 함수를 지나므로 두 화면 모두에 같은 값이 온다.
-- 🔴 표를 쓰지 않는다. 연락처·수납·상담 자료는 싣지 않는다.
-- 🔴 0348h를 손으로 다시 실행했으면 이 파일도 다시 실행한다(뒤에 실행한 정의가 남는다).
-- 멱등: create or replace.

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
    'dedupe_key', case when v_all then r.dedupe_key end,
    'anchor_context', case when r.kind = 'anchor_missing' and v_part is not null then (
      select jsonb_build_object('student_id', p.student_id, 'subject_key', p.subject_key, 'session_date', p.session_date)
        from public.makeup_participants p where p.id = v_part and p.tenant_id = a.tenant_id) end);
end;
$$;

revoke all on all functions in schema makeup_private from public, anon, authenticated;
