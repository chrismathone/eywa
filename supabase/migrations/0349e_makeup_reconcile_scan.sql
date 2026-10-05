-- 0349e — 대사 실행: 사람이 누르는 명령(reconcile)과 주기 실행 함수(public.makeup_reconcile_tenants)
--
-- 관측 트리거는 저장 순간만 본다 — 오류로 놓쳤거나, 날짜가 지나며 달라졌거나(수강 종료일 도래 등), 트리거가 없는 길로 바뀐 것은
-- 대사 실행이 다시 본다. 한 번의 실행(reconcile_scan)이 보는 것:
--   ⓪ 문(gate)과 이 지점의 케이스 행을 먼저 잠근다 — 종결·명령·관측과 같은 잠금을 쓴다(0345f).
--   ① 오늘까지의 살아 있는 참여 — 출결 효과 재검증(0345e: 최신 유효 행·상태·귀속 강사·교시·시수). 맞으면 열려 있던 항목을 닫는다.
--     연결한 보고서의 증거 조건도 다시 본다(0349f). 미처리로 남은 관측 실패·반영 실패 표시는 닫힌 건의 것이라도 다시 확인한다.
--   ② 열린 건의 원수업 칸 — 결석으로 접수했는데 출석이 생겼는가(source_conflict).
--   ③ 열린 건의 수량 — 저장된 합계(조정·면제·인정·약속)와 하위 기록의 합이 같은가(quantity_drift · 종결 차단).
--   ④ 인계 사유(0349d) · ⑤ 정규 시간표와의 충돌(0349c).
-- 🔴 **탐지만 한다.** 출결·시수·보고서·인정량·수량을 고치지 않는다 — 어긋남은 확인 필요 항목으로 올라가 사람이 처리한다.
-- 실행 기록(0343f): 시작·끝·결과·검사 수·새로 열린 수·닫힌 수. 실패도 failed로 남긴다(조용히 0건이 되지 않는다).
--   · 명령 reconcile — 지점 전체 운영 권한. payload {reason}(필수). 결과 {run{status, checked, opened, resolved, error}}.
--     스캔이 실패해도 명령은 실패 기록을 남기고 끝난다(run.status = failed).
--   · public.makeup_reconcile_tenants() — service_role 전용(행위자 없음). 켜짐·정리 중인 지점을 하나씩 돈다. 한 지점의 실패가
--     다른 지점을 막지 않는다. 주기 실행(cron)에서 부른다 — 배선 전까지는 화면의 마지막 실행 시각이 비어 있거나 오래된 채 보인다.
-- 멱등: create or replace.

create or replace function makeup_private.reconcile_scan(p_tenant uuid, p_actor uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_before uuid[];
  v_checked integer := 0;
  v_r record;
begin
  -- 잠금 순서(0345a): 문(gate) → 케이스. 이 지점의 케이스 행을 id순으로 **한 번에** 잠근다 — 명령·관측·종결과 같은 잠금이라
  -- 스캔이 보는 동안 종결이 끼어들지 못하고(반대도 같다), 케이스를 id순으로 잠그는 명령과 교착하지 않는다.
  perform makeup_private.lock_keys(p_tenant, array['gate']);
  perform makeup_private.lock_touched_cases(p_tenant, array(select c.id from public.makeup_cases c where c.tenant_id = p_tenant));
  v_before := array(select r.id from public.makeup_reconciliation r where r.tenant_id = p_tenant and r.state = 'open');
  for v_r in
    select p.id from public.makeup_participants p
     where p.tenant_id = p_tenant and p.status <> 'cancelled' and p.session_date <= v_today
       and (exists (select 1 from public.makeup_allocations al join public.makeup_cases c on c.id = al.case_id
                     where al.participant_id = p.id and c.lifecycle <> 'closed')
            -- 닫힌 건이어도 미처리 작업이 남아 있으면(관측 실패 등) 다시 본다.
            or exists (select 1 from public.makeup_projection_jobs j
                        where j.tenant_id = p_tenant and j.state <> 'done' and (j.participant_id = p.id or p.id = any (j.participant_ids))))
     order by p.id
  loop
    perform makeup_private.sync_attendance_effect(p_tenant, v_r.id, p_actor, false);
    perform makeup_private.observe_report(p_tenant, f.report_id, p_actor)
       from public.makeup_fulfillments f where f.participant_id = v_r.id and f.report_id is not null and f.state <> 'reversed';
    v_checked := v_checked + 1;
  end loop;
  -- 참여 자신의 작업이 아닌 미처리 작업(관측 실패 기록 · 앱이 남긴 반영 실패 표시)도 지금 사실로 다시 확인한다(연결은 하지 않는다).
  for v_r in
    select j.id from public.makeup_projection_jobs j
     where j.tenant_id = p_tenant and j.state <> 'done' and (j.kind <> 'attendance_effect' or j.participant_id is null) order by j.id
  loop
    perform makeup_private.reverify_job(p_tenant, p_actor, v_r.id, false);
    v_checked := v_checked + 1;
  end loop;
  for v_r in
    select distinct c.student_id, c.original_class_id, c.original_date from public.makeup_cases c
     where c.tenant_id = p_tenant and c.lifecycle <> 'closed' and c.original_class_id is not null and c.original_date is not null
  loop
    perform makeup_private.observe_attendance_cell(p_tenant, v_r.student_id, v_r.original_class_id, v_r.original_date, p_actor, false);
    v_checked := v_checked + 1;
  end loop;
  for v_r in
    select c.id,
           jsonb_build_object('adjusted', c.adjusted_minutes, 'waived', c.waived_minutes,
             'recognized', c.recognized_minutes, 'committed', c.committed_minutes) as cached,
           jsonb_build_object(
             'adjusted', coalesce((select sum(x.minutes) from public.makeup_adjustments x where x.case_id = c.id and x.kind = 'quantity'), 0)::integer,
             'waived', coalesce((select sum(x.minutes) from public.makeup_adjustments x where x.case_id = c.id and x.kind = 'waiver'), 0)::integer,
             'recognized', coalesce((select sum(case g.kind when 'recognize' then g.minutes else -g.minutes end)
                                       from public.makeup_recognitions g where g.case_id = c.id), 0)::integer,
             'committed', coalesce((select sum(al.allocated_minutes - al.recognized_minutes - al.released_minutes)
                                      from public.makeup_allocations al where al.case_id = c.id), 0)::integer) as computed
      from public.makeup_cases c where c.tenant_id = p_tenant and c.lifecycle <> 'closed' order by c.id
  loop
    if v_r.cached <> v_r.computed then
      perform makeup_private.open_recon(p_tenant, 'quantity_drift', 'quantity_drift:' || v_r.id::text, true, v_r.id, null, null, null, null,
        jsonb_build_object('cached', v_r.cached, 'computed', v_r.computed));
    else
      update public.makeup_reconciliation r
         set state = 'resolved', resolved_at = now(), resolved_by = p_actor, resolution_note = '수량이 기록과 다시 일치합니다',
             detail = r.detail || '{"auto_resolved": true}'::jsonb
       where r.tenant_id = p_tenant and r.dedupe_key = 'quantity_drift:' || v_r.id::text and r.state = 'open';
    end if;
    v_checked := v_checked + 1;
  end loop;
  perform makeup_private.scan_handover(p_tenant, null, null);
  perform makeup_private.scan_timetable_conflicts(p_tenant);
  return jsonb_build_object('checked', v_checked,
    'opened', (select count(*) from public.makeup_reconciliation r
                where r.tenant_id = p_tenant and r.state = 'open' and not (r.id = any (v_before))),
    'resolved', (select count(*) from public.makeup_reconciliation r
                  where r.tenant_id = p_tenant and r.state <> 'open' and r.id = any (v_before)));
end;
$$;

-- 한 지점의 대사를 실행하고 기록한다. 스캔이 실패하면 그 부분만 되돌리고 실패 기록을 남긴다.
create or replace function makeup_private.run_reconcile(p_tenant uuid, p_actor uuid, p_trigger text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_run uuid;
  v_res jsonb;
begin
  insert into public.makeup_reconciliation_runs (tenant_id, trigger, started_by) values (p_tenant, p_trigger, p_actor) returning id into v_run;
  begin
    v_res := makeup_private.reconcile_scan(p_tenant, p_actor);
    update public.makeup_reconciliation_runs n
       set status = 'succeeded', finished_at = clock_timestamp(), checked = (v_res ->> 'checked')::integer,
           opened = (v_res ->> 'opened')::integer, resolved = (v_res ->> 'resolved')::integer
     where n.id = v_run;
  exception when others then
    update public.makeup_reconciliation_runs n
       set status = 'failed', finished_at = clock_timestamp(), error = left(sqlerrm, 1000) where n.id = v_run;
  end;
  return (select jsonb_build_object('id', n.id, 'status', n.status, 'trigger', n.trigger, 'started_at', n.started_at,
            'finished_at', n.finished_at, 'checked', n.checked, 'opened', n.opened, 'resolved', n.resolved, 'error', n.error)
            from public.makeup_reconciliation_runs n where n.id = v_run);
end;
$$;

create or replace function makeup_private.cmd_reconcile(a makeup_private.actor_ctx, p_cmd uuid, p jsonb, p_rev integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_run jsonb;
begin
  perform makeup_private.require_level(a, 'wide');
  if coalesce(makeup_private.p_text(p, 'reason'), makeup_private.p_text(p, 'note')) is null then
    perform makeup_private.fail('invalid', '대사를 실행하는 사유를 적어 주세요');
  end if;
  v_run := makeup_private.run_reconcile(a.tenant_id, a.user_id, 'manual');
  perform makeup_private.log_event(a.tenant_id, 'reconciliation', (v_run ->> 'id')::uuid, 'reconcile_' || (v_run ->> 'status'), a.user_id, p_cmd,
    null, null, coalesce(makeup_private.p_text(p, 'reason'), makeup_private.p_text(p, 'note')), v_run - 'id');
  perform makeup_private.audit(a, 'reconcile', '보강 대사 실행', jsonb_build_object('command_id', p_cmd, 'run', v_run));
  return makeup_private.result('reconcile', (v_run ->> 'id')::uuid, 1, 'reconcile:' || (v_run ->> 'id'), '{}'::uuid[],
    jsonb_build_object('run', v_run));
end;
$$;

create or replace function public.makeup_reconcile_tenants() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_t uuid;
  v_out jsonb := '[]'::jsonb;
begin
  for v_t in select ts.tenant_id from public.tenant_settings ts
              where makeup_private.normalize_settings(ts.data -> 'makeups') ->> 'mode' <> 'off' order by ts.tenant_id loop
    v_out := v_out || jsonb_build_object('tenant_id', v_t, 'run', makeup_private.run_reconcile(v_t, null, 'scheduled'));
  end loop;
  return jsonb_build_object('tenants', jsonb_array_length(v_out), 'runs', v_out);
end;
$$;

comment on function public.makeup_reconcile_tenants() is
  '보강 대사 주기 실행(0349e). service_role 전용 — 탐지만 한다(출결·시수·인정량을 고치지 않는다).';

revoke all on function public.makeup_reconcile_tenants() from public, anon, authenticated;
grant execute on function public.makeup_reconcile_tenants() to service_role;
revoke all on all functions in schema makeup_private from public, anon, authenticated;
notify pgrst, 'reload schema';
