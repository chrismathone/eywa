-- 0349c — 정규 시간표·수강 저장의 공통 자원 계약(막지 않는다 — 같은 문에 줄을 서고 영향 큐를 남긴다)
--
-- 보강 예약 확정은 지점 시간표 문(gate 잠금, 0345a)을 잡고 정규 시간표를 다시 센다. 그런데 보강 쪽만 잠그면
-- 정규 시간표가 같은 순간에 바뀌는 경합은 못 막는다. 그래서 정규 쪽 저장도 **같은 문에 줄을 선다**:
--   · class_schedules(추가·수정·삭제) · classes(담임·기본 강의실·폐지·종강) · enrollments(수강 추가·기간 변경)
--     저장이 끝난 뒤, 그 지점에 살아 있는(확정·오늘 이후) 보강 회차가 있으면 gate를 잡고 충돌을 다시 계산한다.
--   · 충돌이 생겼으면 **저장은 그대로 두고** 영향 큐(timetable_conflict 대사)에 남긴다 — 정규 저장을 거절하지 않는다.
--     확정 중이던 예약은 gate가 풀린 뒤 바뀐 시간표를 보고 통과/거절이 정해진다(둘 중 하나는 반드시 본다).
--   · 보강관리가 꺼진 지점(대부분)은 조회 한 번으로 끝난다 — 잠금도 잡지 않는다. 켜진 지점은 문을 잠깐 잡았다 놓는다.
-- 충돌 정의는 예약 확정(0345b·0345c)과 같다: 강사의 같은 시각 다른 강의실 · 강의실 정원 초과 · 학생의 시간 겹침.
-- 안에서 오류가 나도 삼킨다(정규 저장은 성공). 교착이 잡히면 그 관측만 버려진다.
-- 멱등: create or replace + drop trigger if exists.

create or replace function makeup_private.scan_timetable_conflicts(p_tenant uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_s record;
  v_class uuid;
  v_regular integer;
  v_makeup integer;
  v_cap integer;
begin
  -- 꺼진 지점은 확정 중인 예약도 없다 → 잠금 없이 통과. 켜진 지점은 문에 줄을 선 **뒤에** 회차를 다시 본다
  -- (확정 중이던 첫 예약이 커밋된 뒤에야 보이기 때문 — 잠금 전에 "회차 없음"으로 빠지면 그 경합을 놓친다).
  if makeup_private.settings(p_tenant) ->> 'mode' = 'off' and not exists (
       select 1 from public.makeup_sessions s
        where s.tenant_id = p_tenant and s.state = 'confirmed' and s.session_date >= v_today) then
    return;
  end if;
  perform makeup_private.lock_keys(p_tenant, array['gate']);
  if not exists (select 1 from public.makeup_sessions s
                  where s.tenant_id = p_tenant and s.state = 'confirmed' and s.session_date >= v_today) then
    return;
  end if;
  for v_s in select s.* from public.makeup_sessions s
              where s.tenant_id = p_tenant and s.state = 'confirmed' and s.session_date >= v_today order by s.id loop
    -- 강사: 같은 시각 다른 강의실의 정규 수업.
    select r.class_id into v_class from makeup_private.regular_slots(p_tenant, v_s.session_date) r
     where r.teacher_id = v_s.teacher_id and r.start_time < v_s.end_time and r.end_time > v_s.start_time
       and r.classroom_id is distinct from v_s.classroom_id limit 1;
    if v_class is not null then
      perform makeup_private.open_recon(p_tenant, 'timetable_conflict', 'tt:teacher:' || v_s.id::text, false, null, null,
        v_s.id, null, null, jsonb_build_object('type', 'teacher', 'class_id', v_class, 'session_date', v_s.session_date));
    end if;
    -- 강의실 정원: 정규 재원 + 보강 참여.
    select cr.capacity into v_cap from public.classrooms cr where cr.id = v_s.classroom_id;
    if v_cap is not null then
      select count(distinct e.student_id) into v_regular
        from makeup_private.regular_slots(p_tenant, v_s.session_date) r
        join public.enrollments e on e.tenant_id = p_tenant and e.class_id = r.class_id and not e.on_hold
       where r.classroom_id = v_s.classroom_id and r.start_time < v_s.end_time and r.end_time > v_s.start_time
         and makeup_private.attends_on(p_tenant, e.student_id, e.class_id, v_s.session_date);
      select count(*) into v_makeup from public.makeup_participants p join public.makeup_sessions x on x.id = p.session_id
       where x.tenant_id = p_tenant and x.state = 'confirmed' and x.session_date = v_s.session_date
         and x.classroom_id = v_s.classroom_id and x.start_time < v_s.end_time and x.end_time > v_s.start_time
         and p.status <> 'cancelled';
      if v_regular + v_makeup > v_cap then
        perform makeup_private.open_recon(p_tenant, 'timetable_conflict', 'tt:room:' || v_s.id::text, false, null, null,
          v_s.id, null, null, jsonb_build_object('type', 'room', 'regular', v_regular, 'makeup', v_makeup,
            'capacity', v_cap, 'session_date', v_s.session_date));
      end if;
    end if;
    -- 학생: 그 학생의 정규 수업과 시간 겹침.
    perform makeup_private.open_recon(p_tenant, 'timetable_conflict', 'tt:student:' || p.id::text, false,
        (select al.case_id from public.makeup_allocations al where al.participant_id = p.id order by al.case_id limit 1),
        p.id, v_s.id, null, null,
        jsonb_build_object('type', 'student', 'student_id', p.student_id, 'class_id', r.class_id, 'session_date', v_s.session_date))
      from public.makeup_participants p
      join lateral (select x.class_id from makeup_private.regular_slots(p_tenant, v_s.session_date) x
                     where x.start_time < v_s.end_time and x.end_time > v_s.start_time
                       and makeup_private.attends_on(p_tenant, p.student_id, x.class_id, v_s.session_date) limit 1) r on true
     where p.session_id = v_s.id and p.status = 'unknown';
  end loop;
end;
$$;

-- 문장 단위(행이 수백 줄인 시간표 가져오기도 지점당 한 번만 돈다).
create or replace function makeup_private.tg_observe_timetable() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_tenant uuid;
begin
  begin
    if tg_op = 'DELETE' then
      for v_tenant in select distinct o.tenant_id from old_rows o loop perform makeup_private.scan_timetable_conflicts(v_tenant); end loop;
    else
      for v_tenant in select distinct n.tenant_id from new_rows n loop perform makeup_private.scan_timetable_conflicts(v_tenant); end loop;
    end if;
  exception when others then null;
  end;
  return null;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['class_schedules', 'classes', 'enrollments'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_makeup_observe_ins', t);
    execute format('drop trigger if exists %I on public.%I', t || '_makeup_observe_upd', t);
    execute format('drop trigger if exists %I on public.%I', t || '_makeup_observe_del', t);
    execute format('create trigger %I after update on public.%I referencing new table as new_rows for each statement execute function makeup_private.tg_observe_timetable()',
      t || '_makeup_observe_upd', t);
    if t <> 'classes' then
      execute format('create trigger %I after insert on public.%I referencing new table as new_rows for each statement execute function makeup_private.tg_observe_timetable()',
        t || '_makeup_observe_ins', t);
      execute format('create trigger %I after delete on public.%I referencing old table as old_rows for each statement execute function makeup_private.tg_observe_timetable()',
        t || '_makeup_observe_del', t);
    end if;
  end loop;
end $$;

revoke all on all functions in schema makeup_private from public, anon, authenticated;
