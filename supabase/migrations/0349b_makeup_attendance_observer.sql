-- 0349b — 정규 출결 저장의 관측 트리거(막지 않는다 — 대사·반영 작업으로 남길 뿐)
--
-- 🔴 정규 출결의 상태·시수 저장은 어떤 보강 제약으로도 거절하거나 되돌리지 않는다(키오스크·좌석·엑셀 포함).
--    트리거는 저장이 **끝난 뒤**(INSERT · UPDATE · DELETE 모두) 원장과 관계있는 칸만 골라 다시 본다. 안에서 오류가 나도 삼키고
--    (출결 저장은 그대로 성공), 실패 사실을 반영 작업(failed)으로 남긴다 — 그 학생·그날에 닿는 케이스·참여를 전부 적어
--    그 케이스들의 종결을 막는다(실패를 0건·완료로 보이지 않게, 케이스에 묶이지 않아 숨지 않게).
--    원장이 그 학생·그날과 무관하면(대부분의 저장) 인덱스 조회 두 번으로 끝난다.
-- 한 칸(학생·반·날짜)을 다시 보는 일은 observe_attendance_cell 하나가 한다 — 트리거·반영 작업 재시도·대사 실행이 같이 쓴다:
--   · 케이스의 원수업 칸: 최신 유효 행이 시수 상태(출석·지각·조퇴·보강)면 source_conflict(종결 차단). 다시 결석이 되면 닫는다.
--     자동 삭제·소멸 없음 — 사람이 본다. **닫힌 건도 본다**(보강을 끝낸 뒤 원결석이 출석으로 바뀐 것은 뒤늦게라도 보여야 한다).
--   · 쓰기 전에 닿는 케이스 행을 잠가 종결과 줄을 선다(0345f lock_touched_cases).
--   · 그날 그 반이 앵커인 참여: 0345e sync_attendance_effect로 판정(맞음 → done · 자료 없음/참여 전 → pending ·
--     시수 차이·귀속 불일치·노쇼인데 출석 → failed + 대사). 기존 행의 시수·상태·귀속 강사를 **고치는 저장(UPDATE)** 도 같은 길을 지난다.
--   · evidence_removed — 참여·실시 기록에 연결된 출결 행이 지워진다(삭제 자체는 막지 않는다). 종결을 막는다.
-- 멱등: create or replace + drop trigger if exists.

create or replace function makeup_private.observe_attendance_cell(
  p_tenant uuid, p_student uuid, p_class uuid, p_date date, p_actor uuid, p_link boolean
) returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_att uuid; v_status text;
  v_part uuid;
  v_n integer := 0;
begin
  -- 닿는 케이스(원수업 칸의 건 + 그날 그 반이 출결 반인 참여의 건)를 먼저 잠근다 — 종결과 줄을 선다(0345f).
  perform makeup_private.lock_touched_cases(p_tenant, array(
    select c.id from public.makeup_cases c
     where c.tenant_id = p_tenant and c.student_id = p_student and c.original_class_id = p_class and c.original_date = p_date
    union
    select al.case_id from public.makeup_allocations al join public.makeup_participants p on p.id = al.participant_id
     where p.tenant_id = p_tenant and p.student_id = p_student and p.session_date = p_date and p.anchor_class_id = p_class));
  select ar.id, ar.status::text into v_att, v_status from public.attendance_records ar
   where ar.tenant_id = p_tenant and ar.student_id = p_student and ar.class_id = p_class and ar.session_date = p_date
   order by ar.recorded_at desc, ar.id desc limit 1;
  if v_status in ('present', 'late', 'early_leave', 'makeup') then
    -- 닫힌 건도 본다: 보강까지 끝낸 뒤에 원결석이 출석으로 바뀌면 사람이 알아야 한다(원수업 정정으로 닫은 건·중복·거절은 제외).
    perform makeup_private.open_recon(p_tenant, 'source_conflict', 'source_conflict:' || c.id::text, true, c.id, null, null, v_att, null,
        jsonb_build_object('attendance_record_id', v_att, 'status', v_status, 'case_lifecycle', c.lifecycle))
      from public.makeup_cases c
     where c.tenant_id = p_tenant and c.student_id = p_student and c.original_class_id = p_class and c.original_date = p_date
       and c.eligibility <> 'denied'
       and (c.lifecycle <> 'closed' or coalesce(c.closure_reason, '') not in ('source_retracted', 'duplicate'));
  else
    update public.makeup_reconciliation r
       set state = 'resolved', resolved_at = now(), resolved_by = p_actor, resolution_note = '원수업 칸이 다시 결석으로 정정되었습니다',
           detail = r.detail || '{"auto_resolved": true}'::jsonb
     where r.tenant_id = p_tenant and r.kind = 'source_conflict' and r.state = 'open'
       and r.case_id in (select c.id from public.makeup_cases c
                          where c.tenant_id = p_tenant and c.student_id = p_student and c.original_class_id = p_class and c.original_date = p_date);
  end if;
  for v_part in select p.id from public.makeup_participants p
                 where p.tenant_id = p_tenant and p.student_id = p_student and p.session_date = p_date
                   and p.anchor_class_id = p_class and p.status <> 'cancelled' order by p.id loop
    perform makeup_private.sync_attendance_effect(p_tenant, v_part, p_actor, p_link);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- 그 학생·그날이 원장과 관계있는가(트리거의 빠른 통과 판정).
create or replace function makeup_private.attendance_relevant(p_tenant uuid, p_student uuid, p_date date) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.makeup_cases c
                  where c.tenant_id = p_tenant and c.student_id = p_student and c.original_date = p_date)
      or exists (select 1 from public.makeup_participants p
                  where p.tenant_id = p_tenant and p.student_id = p_student and p.session_date = p_date and p.status <> 'cancelled')
$$;

create or replace function makeup_private.tg_observe_attendance() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.attendance_records%rowtype;
  v_moved boolean := false;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  if tg_op = 'UPDATE' then
    v_moved := (old.student_id, old.class_id, old.session_date) is distinct from (new.student_id, new.class_id, new.session_date);
  end if;
  if not makeup_private.attendance_relevant(r.tenant_id, r.student_id, r.session_date)
     and not (v_moved and makeup_private.attendance_relevant(old.tenant_id, old.student_id, old.session_date)) then
    return null;
  end if;
  begin
    perform makeup_private.observe_attendance_cell(r.tenant_id, r.student_id, r.class_id, r.session_date, null, false);
    if v_moved then
      perform makeup_private.observe_attendance_cell(old.tenant_id, old.student_id, old.class_id, old.session_date, null, false);
    end if;
  exception when others then
    begin
      -- 실패를 남긴다: 그 학생·그날에 닿는 케이스·참여 전부를 적어 종결을 막는다.
      insert into public.makeup_projection_jobs (tenant_id, kind, effect_key, state, payload, last_error, case_ids, participant_ids)
        values (r.tenant_id, 'attendance_effect', 'att-observe-failed:' || r.id::text, 'failed',
          jsonb_build_object('attendance_record_id', r.id, 'student_id', r.student_id, 'class_id', r.class_id, 'session_date', r.session_date),
          left(sqlerrm, 1000),
          coalesce(array(
            select c.id from public.makeup_cases c
             where c.tenant_id = r.tenant_id and c.student_id = r.student_id and c.original_date = r.session_date
            union
            select al.case_id from public.makeup_allocations al join public.makeup_participants p on p.id = al.participant_id
             where p.tenant_id = r.tenant_id and p.student_id = r.student_id and p.session_date = r.session_date and p.status <> 'cancelled'), '{}'::uuid[]),
          coalesce(array(select p.id from public.makeup_participants p
                          where p.tenant_id = r.tenant_id and p.student_id = r.student_id and p.session_date = r.session_date
                            and p.status <> 'cancelled'), '{}'::uuid[]))
        on conflict (tenant_id, effect_key) do update set state = 'failed', last_error = excluded.last_error,
          case_ids = excluded.case_ids, participant_ids = excluded.participant_ids;
    exception when others then null;
    end;
  end;
  return null;
end;
$$;

drop trigger if exists attendance_records_makeup_observe on public.attendance_records;
create trigger attendance_records_makeup_observe
  after insert or update or delete on public.attendance_records
  for each row execute function makeup_private.tg_observe_attendance();

create or replace function makeup_private.tg_observe_attendance_delete() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from public.makeup_participants p where p.attendance_record_id = old.id)
     and not exists (select 1 from public.makeup_fulfillments f where f.attendance_record_id = old.id) then
    return old;
  end if;
  begin
    perform makeup_private.lock_touched_cases(old.tenant_id, array(
      select al.case_id from public.makeup_allocations al join public.makeup_participants p on p.id = al.participant_id
       where p.tenant_id = old.tenant_id
         and (p.attendance_record_id = old.id
              or exists (select 1 from public.makeup_fulfillments f where f.participant_id = p.id and f.attendance_record_id = old.id))));
    perform makeup_private.open_recon(old.tenant_id, 'evidence_removed', 'evidence_removed:' || p.id::text || ':' || old.id::text,
        true, (select al.case_id from public.makeup_allocations al where al.participant_id = p.id order by al.case_id limit 1),
        p.id, p.session_id, old.id, null,
        jsonb_build_object('attendance_record_id', old.id, 'status', old.status, 'session_units', old.session_units,
          'session_date', old.session_date, 'participation', p.status,
          'case_ids', (select coalesce(jsonb_agg(al.case_id), '[]'::jsonb) from public.makeup_allocations al where al.participant_id = p.id)))
      from public.makeup_participants p
     where p.tenant_id = old.tenant_id
       and (p.attendance_record_id = old.id
            or exists (select 1 from public.makeup_fulfillments f where f.participant_id = p.id and f.attendance_record_id = old.id));
  exception when others then null;
  end;
  return old;
end;
$$;

-- BEFORE: 연결(FK set null)이 끊기기 전에 어느 참여의 근거였는지 읽어야 한다. 삭제는 그대로 진행된다.
drop trigger if exists attendance_records_makeup_observe_delete on public.attendance_records;
create trigger attendance_records_makeup_observe_delete
  before delete on public.attendance_records
  for each row execute function makeup_private.tg_observe_attendance_delete();

-- 담당자·실시 강사가 재직이 아니게 되면 미처리 건이 숨지 않도록 대체 배정 큐에 올린다.
create or replace function makeup_private.tg_observe_user_status() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from public.makeup_cases c where c.tenant_id = new.tenant_id and c.owner_id = new.id and c.lifecycle <> 'closed')
     and not exists (select 1 from public.makeup_sessions s where s.tenant_id = new.tenant_id and s.teacher_id = new.id and s.state = 'confirmed') then
    return null;
  end if;
  begin
    perform makeup_private.open_recon(new.tenant_id, 'owner_inactive', 'owner_inactive:' || c.id::text || ':' || new.id::text,
        false, c.id, null, null, null, null, jsonb_build_object('user_id', new.id))
      from public.makeup_cases c
     where c.tenant_id = new.tenant_id and c.owner_id = new.id and c.lifecycle <> 'closed';
    perform makeup_private.open_recon(new.tenant_id, 'teacher_inactive', 'teacher_inactive:' || s.id::text || ':' || new.id::text,
        false, null, null, s.id, null, null, jsonb_build_object('user_id', new.id, 'session_date', s.session_date,
          'case_ids', (select coalesce(jsonb_agg(distinct al.case_id), '[]'::jsonb) from public.makeup_participants p
                         join public.makeup_allocations al on al.participant_id = p.id where p.session_id = s.id)))
      from public.makeup_sessions s
     where s.tenant_id = new.tenant_id and s.teacher_id = new.id and s.state = 'confirmed';
  exception when others then null;
  end;
  return null;
end;
$$;

drop trigger if exists users_makeup_observe_status on public.users;
create trigger users_makeup_observe_status
  after update of status on public.users
  for each row when (old.status = 'active' and new.status <> 'active')
  execute function makeup_private.tg_observe_user_status();

revoke all on all functions in schema makeup_private from public, anon, authenticated;
