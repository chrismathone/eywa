-- 0348g — 읽기 RPC: 확인 필요 목록 public.makeup_list_reconciliation · 변경 이력 public.makeup_case_events
--
-- makeup_list_reconciliation — 실패·대사 큐. 대사 항목과 미처리(pending/failed) 반영 작업을 **각각 넘겨 읽는다**.
--   p_filter: {state(기본 open · all), kind, case_id, page, page_size(최대 100), projection_page, projection_page_size(최대 100)}
--   반환: {mode, total, page, page_size, rows[], projection_jobs[], projection_total, projection_page, projection_page_size,
--          projection_pending, projection_failed, last_success_at, last_run, permissions{resolve_reconciliation, reconcile, accept_manual_units}}
--   · rows[] · projection_jobs[]는 0348h를 거쳐 나간다: case_ids·participant_ids는 **행위자 범위 안의 것만**, summary = 화면용 한 줄,
--     수납 확인(billing_review)은 수납 읽기 권한이 없으면 restricted: true(항목이 있다는 사실만).
--   · 범위: 지점 전체 읽기 권한이 아니면 닿는 케이스·참여 가운데 하나라도 내 범위인 항목만(0344c recon_in_scope · job_in_scope).
--     case_id 조건도 직접 연결만이 아니라 "닿는가"로 본다(회차 단위 항목이 숨지 않게).
--   · last_run = 마지막 대사 실행(0349e) — 실패했거나 한 번도 안 돌았으면 화면이 그대로 말한다(지점 전체 읽기 권한에만 준다).
-- makeup_case_events(p_case_id, p_filter{page, page_size(기본 50 · 최대 100)}) → {rows[], total, page, page_size}
--   rows = {id, event_type, actor_name, reason, occurred_at, entity_type, entity_id, session_id, command_id, data,
--           from_revision, to_revision} — 최신순. 범위는 상세(makeup_case_detail)와 같다(범위 밖은 "없음").
--   이 건의 이벤트 + 이 건이 걸린 회차의 회차 단위 이벤트(다른 건에 속한 이벤트는 싣지 않는다).
-- 🔴 둘 다 꺼짐(off)이면 예외 — 실패를 빈 목록·0건으로 위장하지 않는다.
-- 멱등: create or replace.

create or replace function makeup_private.recon_summary(p_kind text, p_detail jsonb) returns text
language sql immutable set search_path = pg_catalog as $$
  select case
    when p_kind in ('units_mismatch', 'units_review', 'attendance_observed') then
      makeup_private.attendance_issue_text(coalesce(p_detail ->> 'code', p_kind))
        || case when p_detail ? 'actual_units'
                then ' (지금 시수 ' || (p_detail ->> 'actual_units') || coalesce(' · 예상 ' || (p_detail ->> 'expected_units'), '') || ')' else '' end
    when p_kind = 'source_conflict' then '결석으로 접수한 원수업 날에 출석 기록이 있습니다 — 원수업 출결을 확인해 주세요'
    when p_kind = 'evidence_removed' and p_detail ->> 'source' = 'report' then
      case p_detail ->> 'code' when 'report_recalled' then '보강 근거로 연결한 보고서가 회수되었습니다 — 근거를 다시 확인해 주세요'
        else '보강 근거로 연결한 보고서가 바뀌었습니다 — 근거를 다시 확인해 주세요' end
    when p_kind = 'evidence_removed' then '보강 근거로 연결한 출결 기록이 지워졌습니다'
    when p_kind = 'handover_review' then '담당이 바뀌었거나 수강이 끝난 학생의 보강이 남아 있습니다 — 담당자를 다시 정해 주세요'
    when p_kind = 'quantity_drift' then '남은 분량 계산이 기록과 다릅니다 — 확인 후 다시 계산해 주세요'
    when p_kind = 'teacher_inactive' then '보강을 맡은 강사가 재직 중이 아닙니다 — 강사를 다시 정해 주세요'
    when p_kind = 'owner_inactive' then '담당자가 재직 중이 아닙니다 — 담당자를 다시 정해 주세요'
    when p_kind = 'timetable_conflict' then '정규 시간표가 바뀌어 잡아 둔 보강과 겹칩니다'
    when p_kind = 'anchor_missing' then '출결·보고서를 세울 반이 정해지지 않았습니다'
    when p_kind = 'billing_review' then '수납 기준을 확인해 주세요'
    else null end
$$;

create or replace function public.makeup_list_reconciliation(p_filter jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  a makeup_private.actor_ctx := makeup_private.actor();
  f jsonb := coalesce(p_filter, '{}'::jsonb);
  v_all boolean;
  v_state text := coalesce(makeup_private.p_text(f, 'state'), 'open');
  v_kind text := makeup_private.p_text(f, 'kind');
  v_case uuid := makeup_private.p_uuid(f, 'case_id');
  v_page integer := greatest(coalesce(makeup_private.p_int(f, 'page'), 1), 1);
  v_size integer := least(greatest(coalesce(makeup_private.p_int(f, 'page_size'), 50), 1), 100);
  v_jpage integer := greatest(coalesce(makeup_private.p_int(f, 'projection_page'), 1), 1);
  v_jsize integer := least(greatest(coalesce(makeup_private.p_int(f, 'projection_page_size'), 50), 1), 100);
  v_out jsonb;
begin
  perform makeup_private.require_mode(a, 'read');
  v_all := makeup_private.can_read_all(a);
  if v_case is not null and not makeup_private.in_scope(a, v_case) then
    perform makeup_private.fail('not_found', '보강 건을 찾을 수 없습니다');
  end if;
  -- 행을 통째(rec)로 들고 다닌다 — 0344c 함수가 표의 행 타입을 받기 때문이다.
  with picked as (
    select r as rec from public.makeup_reconciliation r
     where r.tenant_id = a.tenant_id
       and (v_state = 'all' or r.state = v_state) and (v_kind is null or r.kind = v_kind)
       and (v_case is null or makeup_private.recon_touches(r, v_case))
       and (v_all or makeup_private.recon_in_scope(a, r))
  ), jobs as (
    select j as rec from public.makeup_projection_jobs j
     where j.tenant_id = a.tenant_id and j.state in ('pending', 'failed')
       and (v_case is null or makeup_private.job_touches(j, v_case))
       and (v_all or makeup_private.job_in_scope(a, j))
  )
  select jsonb_build_object(
    'mode', a.mode, 'page', v_page, 'page_size', v_size, 'last_success_at', now(),
    'total', (select count(*) from picked),
    'rows', coalesce((select jsonb_agg(makeup_private.recon_public(a, x.rec)
        order by (x.rec).created_at desc, (x.rec).id) from (
        select p.rec from picked p order by (p.rec).created_at desc, (p.rec).id offset (v_page - 1) * v_size limit v_size) x), '[]'::jsonb),
    'projection_total', (select count(*) from jobs),
    'projection_pending', (select count(*) from jobs q where (q.rec).state = 'pending'),
    'projection_failed', (select count(*) from jobs q where (q.rec).state = 'failed'),
    'projection_page', v_jpage, 'projection_page_size', v_jsize,
    'projection_jobs', coalesce((select jsonb_agg(makeup_private.job_public(a, x.rec) order by (x.rec).updated_at desc, (x.rec).id) from (
        select q.rec from jobs q order by (q.rec).updated_at desc, (q.rec).id offset (v_jpage - 1) * v_jsize limit v_jsize) x), '[]'::jsonb),
    'last_run', case when v_all then (
        select jsonb_build_object('id', n.id, 'status', n.status, 'trigger', n.trigger, 'started_at', n.started_at,
                 'finished_at', n.finished_at, 'checked', n.checked, 'opened', n.opened, 'resolved', n.resolved, 'error', n.error)
          from public.makeup_reconciliation_runs n where n.tenant_id = a.tenant_id order by n.started_at desc, n.id desc limit 1) end,
    'permissions', jsonb_build_object('resolve_reconciliation', a.wide, 'reconcile', a.wide, 'accept_manual_units', a.privileged,
      'read_billing', makeup_private.can_read_billing()))
    into v_out;
  return v_out;
end;
$$;

create or replace function public.makeup_case_events(p_case_id uuid, p_filter jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  a makeup_private.actor_ctx := makeup_private.actor();
  f jsonb := coalesce(p_filter, '{}'::jsonb);
  v_page integer := greatest(coalesce(makeup_private.p_int(f, 'page'), 1), 1);
  v_size integer := least(greatest(coalesce(makeup_private.p_int(f, 'page_size'), 50), 1), 100);
  v_sessions uuid[];
  v_out jsonb;
begin
  perform makeup_private.require_mode(a, 'read');
  if p_case_id is null or not makeup_private.in_scope(a, p_case_id) then
    perform makeup_private.fail('not_found', '보강 건을 찾을 수 없습니다');
  end if;
  select coalesce(array_agg(distinct p.session_id), '{}'::uuid[]) into v_sessions
    from public.makeup_allocations al join public.makeup_participants p on p.id = al.participant_id
   where al.case_id = p_case_id;
  with picked as (
    select ev.* from public.makeup_events ev
     where ev.tenant_id = a.tenant_id and (ev.case_id = p_case_id or ev.session_id = any (v_sessions))
       and (ev.case_id is null or ev.case_id = p_case_id)
  )
  select jsonb_build_object('page', v_page, 'page_size', v_size, 'total', (select count(*) from picked),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'event_type', e.event_type,
          'actor_name', (select u.display_name from public.users u where u.id = e.actor_id), 'reason', e.reason,
          'occurred_at', e.occurred_at, 'entity_type', e.entity_type, 'entity_id', e.entity_id, 'session_id', e.session_id,
          'command_id', e.command_id, 'data', makeup_private.scrub_json(a, e.data), 'from_revision', e.from_revision, 'to_revision', e.to_revision)
        order by e.occurred_at desc, e.id) from (
        select p.* from picked p order by p.occurred_at desc, p.id offset (v_page - 1) * v_size limit v_size) e), '[]'::jsonb))
    into v_out;
  return v_out;
end;
$$;

revoke all on function public.makeup_list_reconciliation(jsonb) from public, anon, service_role;
revoke all on function public.makeup_case_events(uuid, jsonb) from public, anon, service_role;
grant execute on function public.makeup_list_reconciliation(jsonb) to authenticated;
grant execute on function public.makeup_case_events(uuid, jsonb) to authenticated;
revoke all on all functions in schema makeup_private from public, anon, authenticated;
notify pgrst, 'reload schema';
