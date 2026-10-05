-- 0349f — 연결된 보고서의 관측: 증거로 연결한 보고서가 **나중에** 회수되거나 보강 표시·보강 반이 바뀌면 보이게 한다
--
-- 연결은 보고서를 고치지 않고, 보고서의 본문 수정·발송·회수도 원장이 막지 않는다(0349a는 삭제와 학생·날짜·과목·반 변경만 막는다).
-- 그래서 연결한 뒤 보고서가 달라질 수 있다 — 그때 원장의 실시 기록을 **조용히 고치지 않고** 확인 항목을 연다:
--   · 회수 요청·회수 중·회수됨 → report_recalled
--   · 보강 표시가 꺼졌거나 과목이 달라짐 → report_not_makeup · 보강 반이 출결 반과 달라짐 → report_other_anchor
--   · 발송 처리 중(processing)은 지나가는 상태라 항목을 열지도 닫지도 않는다.
--   항목 = evidence_removed(종결 차단 · detail.source = report). 검토를 마쳤거나 **이미 닫힌 건**이어도 열린다 —
--   뒤늦은 증거 변경은 닫힌 건의 목록·상세에 보인다. 보고서가 다시 맞게 되면(재발송 등) 스스로 닫힌다.
-- 🔴 실시 기록·인정·수량은 건드리지 않는다. 인정을 되돌릴지는 사람이 정한다(reverse 명령).
-- 🔴 보고서 저장을 막지 않는다 — 안에서 오류가 나도 삼키고 실패 작업을 남긴다(대사 실행이 다시 본다).
-- 보고서 삭제: 살아 있는 실시 기록에 연결된 보고서는 0349a가 거절한다. 반전된(reversed) 기록의 보고서만 지워지고, 그때 연결 칸은
--   참조 무결성 동작(set null)으로만 빈다 — 0343e allow_unlink가 "실제로 지워진 행"일 때만 통과시킨다(직접 UPDATE 불가).
-- 멱등: create or replace + drop trigger if exists.

create or replace function makeup_private.observe_report(p_tenant uuid, p_report uuid, p_actor uuid) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_f record;
  v_p public.makeup_participants%rowtype;
  v_cases uuid[];
  v_issue text;
  v_n integer := 0;
begin
  for v_f in
    select f.id, f.state, f.participant_id, coalesce(f.actual_teacher_id, s.teacher_id) as teacher_id
      from public.makeup_fulfillments f
      join public.makeup_participants p on p.id = f.participant_id
      join public.makeup_sessions s on s.id = p.session_id
     where f.tenant_id = p_tenant and f.report_id = p_report and f.state <> 'reversed' order by f.id
  loop
    v_cases := array(select al.case_id from public.makeup_allocations al where al.participant_id = v_f.participant_id order by al.case_id);
    perform makeup_private.lock_touched_cases(p_tenant, v_cases);
    select * into v_p from public.makeup_participants x where x.id = v_f.participant_id;
    v_issue := makeup_private.report_issue(p_tenant, p_report, v_p, v_f.teacher_id);
    if v_issue = 'report_sending' then
      continue;
    elsif v_issue is not null then
      perform makeup_private.open_recon(p_tenant, 'evidence_removed', 'evidence_report:' || v_f.id::text, true, v_cases[1],
        v_f.participant_id, v_p.session_id, null, null,
        jsonb_build_object('source', 'report', 'code', v_issue, 'report_id', p_report, 'fulfillment_id', v_f.id,
          'fulfillment_state', v_f.state, 'case_ids', to_jsonb(v_cases),
          'classnote_status', (select lr.classnote_status from public.lesson_reports lr where lr.id = p_report)));
      v_n := v_n + 1;
    else
      update public.makeup_reconciliation r
         set state = 'resolved', resolved_at = now(), resolved_by = p_actor, resolution_note = '보고서가 다시 증거 조건에 맞습니다',
             detail = r.detail || '{"auto_resolved": true}'::jsonb
       where r.tenant_id = p_tenant and r.dedupe_key = 'evidence_report:' || v_f.id::text and r.state = 'open';
    end if;
  end loop;
  return v_n;
end;
$$;

create or replace function makeup_private.tg_observe_report() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from public.makeup_fulfillments f where f.report_id = new.id and f.state <> 'reversed') then
    return null;
  end if;
  begin
    perform makeup_private.observe_report(new.tenant_id, new.id, null);
  exception when others then
    begin
      insert into public.makeup_projection_jobs (tenant_id, kind, effect_key, state, payload, last_error, case_ids, participant_ids)
        values (new.tenant_id, 'effect_gap', 'report-observe-failed:' || new.id::text, 'failed',
          jsonb_build_object('gap_kind', 'report_observe_failed', 'report_id', new.id), left(sqlerrm, 1000),
          coalesce(array(select distinct al.case_id from public.makeup_fulfillments f
                           join public.makeup_allocations al on al.participant_id = f.participant_id
                          where f.report_id = new.id and f.state <> 'reversed'), '{}'::uuid[]),
          coalesce(array(select distinct f.participant_id from public.makeup_fulfillments f
                          where f.report_id = new.id and f.state <> 'reversed'), '{}'::uuid[]))
        on conflict (tenant_id, effect_key) do update set state = 'failed', last_error = excluded.last_error,
          case_ids = excluded.case_ids, participant_ids = excluded.participant_ids;
    exception when others then null;
    end;
  end;
  return null;
end;
$$;

drop trigger if exists lesson_reports_makeup_observe on public.lesson_reports;
create trigger lesson_reports_makeup_observe
  after update of classnote_status, makeup, makeup_class_id, subject on public.lesson_reports
  for each row execute function makeup_private.tg_observe_report();

revoke all on all functions in schema makeup_private from public, anon, authenticated;
