-- 0346a — 명령: 접수(intake) + payload 읽기 도우미
--
-- 원사건과 접수 경로를 나눈다.
--   · 원사건 키(occurrence_key)는 **서버가 만든다**: 원수업이 있으면 `day:<학생>:<원반>:<원수업일>`(수학 일 단위),
--     원결석 없는 추가 지도는 `manual:<uuid>`. 요청이 키를 보내면 서버 값과 같아야 한다(다르면 거절).
--   · 접수 경로(출결 행·수동)는 `makeup_case_sources`에 별칭으로 붙는다. 같은 원수업을 다른 경로로 다시
--     접수하면 새 케이스가 아니라 **같은 케이스에 근거만 추가**된다(동시에 접수해도 한 건 — 사건 범위 잠금 + 유니크).
--   · 접수는 권리 발급이 아니다: eligibility = pending, 목표 분량 = null. 승인(0346b)이 따로 있다.
-- 과목은 원반에서 서버가 정한다(요청값을 믿지 않는다). 과목을 확인할 수 없거나 첫 출시 대상 과목이 아니면 거절.
-- 강사 범위 계정은 지금 담당하는 반(추가 지도는 지금 담당 반의 재원 학생)만 접수할 수 있다.
-- 멱등: create or replace.

create or replace function makeup_private.p_text(p jsonb, k text) returns text
language sql immutable set search_path = pg_catalog as $$ select nullif(btrim(p ->> k), '') $$;
create or replace function makeup_private.p_uuid(p jsonb, k text) returns uuid
language sql immutable set search_path = pg_catalog as $$ select nullif(btrim(p ->> k), '')::uuid $$;
create or replace function makeup_private.p_int(p jsonb, k text) returns integer
language sql immutable set search_path = pg_catalog as $$
  select case when jsonb_typeof(p -> k) = 'number' and (p ->> k)::numeric = trunc((p ->> k)::numeric)
              then (p ->> k)::integer end
$$;
create or replace function makeup_private.p_date(p jsonb, k text) returns date
language sql immutable set search_path = pg_catalog as $$
  select case when p ->> k ~ '^\d{4}-\d{2}-\d{2}$' then (p ->> k)::date end
$$;

-- 담당자·강사로 지정할 수 있는 사람(같은 학원의 재직 직원)인지.
create or replace function makeup_private.assert_staff(p_tenant uuid, p_user uuid) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_user is not null and not exists (
       select 1 from public.users u where u.id = p_user and u.tenant_id = p_tenant
          and u.status = 'active' and u.system_role::text <> 'student') then
    perform makeup_private.fail('invalid', '담당자는 재직 중인 직원만 지정할 수 있습니다');
  end if;
end;
$$;

create or replace function makeup_private.cmd_intake(a makeup_private.actor_ctx, p_cmd uuid, p jsonb, p_rev integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_student uuid := makeup_private.p_uuid(p, 'student_id');
  v_class uuid := makeup_private.p_uuid(p, 'original_class_id');
  v_date date := makeup_private.p_date(p, 'original_date');
  v_reason text := coalesce(makeup_private.p_text(p, 'reason'), 'absence');
  v_subject text := makeup_private.p_text(p, 'subject_key');
  v_kind text := coalesce(makeup_private.p_text(p, 'source_kind'), 'manual');
  v_source text := makeup_private.p_text(p, 'source_id');
  v_owner uuid := makeup_private.p_uuid(p, 'owner_id');
  v_key text;
  v_class_subject text;
  v_snapshot jsonb;
  v_att public.attendance_records%rowtype;
  v_case public.makeup_cases%rowtype;
  v_existing uuid;
  v_new boolean := false;
begin
  perform makeup_private.require_level(a, 'write');
  if p ? 'unit_kind' and p ->> 'unit_kind' is distinct from 'minutes' then
    perform makeup_private.fail('invalid', '보강 분량은 분 단위로만 다룹니다');
  end if;
  if v_reason not in ('absence', 'planned_absence', 'class_cancelled', 'additional') then
    perform makeup_private.fail('invalid', '접수 사유를 골라 주세요');
  end if;
  if v_kind not in ('attendance', 'manual') then
    perform makeup_private.fail('invalid', '접수 경로가 올바르지 않습니다 — 기존 예약은 예약 연결로 접수해 주세요');
  end if;
  if v_student is null or not exists (
       select 1 from public.students s where s.id = v_student and s.tenant_id = a.tenant_id) then
    perform makeup_private.fail('not_found', '학생을 찾을 수 없습니다');
  end if;

  if v_reason = 'additional' then
    -- 원결석 없는 추가 지도: 가짜 결석일을 만들지 않는다.
    if v_class is not null or v_date is not null or v_kind <> 'manual' then
      perform makeup_private.fail('invalid', '추가 지도에는 원수업 정보를 넣지 않습니다');
    end if;
    v_key := coalesce(makeup_private.p_text(p, 'occurrence_key'), 'manual:' || p_cmd::text);
    if v_key !~ '^manual:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      perform makeup_private.fail('invalid', '추가 지도 접수 정보가 올바르지 않습니다');
    end if;
    if not a.wide and not makeup_private.teaches_student(a, v_student, v_subject) then
      perform makeup_private.fail('forbidden', '담당하는 학생만 접수할 수 있습니다');
    end if;
  else
    if v_class is null or v_date is null then
      perform makeup_private.fail('invalid', '원수업 반과 날짜를 넣어 주세요');
    end if;
    select c.subject into v_class_subject from public.classes c where c.id = v_class and c.tenant_id = a.tenant_id;
    if not found then perform makeup_private.fail('not_found', '원수업 반을 찾을 수 없습니다'); end if;
    if v_subject is not null and v_subject <> v_class_subject then
      perform makeup_private.fail('invalid', '원수업 반의 과목과 다릅니다');
    end if;
    v_subject := v_class_subject;
    if not exists (select 1 from public.enrollments e
                    where e.tenant_id = a.tenant_id and e.student_id = v_student and e.class_id = v_class
                      and e.start_date <= v_date and (e.end_date is null or e.end_date > v_date)) then
      perform makeup_private.fail('invalid', '그날 그 반의 수강생이 아닙니다 — 원수업 반과 날짜를 확인해 주세요');
    end if;
    v_key := 'day:' || v_student::text || ':' || v_class::text || ':' || to_char(v_date, 'YYYY-MM-DD');
    if makeup_private.p_text(p, 'occurrence_key') is distinct from null
       and makeup_private.p_text(p, 'occurrence_key') <> v_key then
      perform makeup_private.fail('invalid', '원수업 정보가 서로 맞지 않습니다 — 새로 고친 뒤 다시 접수해 주세요');
    end if;
    if not a.wide and not (v_class in (select makeup_private.my_class_ids(a.tenant_id, a.user_id, a.today))) then
      perform makeup_private.fail('forbidden', '담당하는 반의 결석만 접수할 수 있습니다');
    end if;
  end if;
  if v_subject is null or v_subject !~ '^[a-z0-9_]{1,24}$' then
    perform makeup_private.fail('invalid', '과목을 확인할 수 없어 접수할 수 없습니다');
  end if;
  if not (v_subject = any (a.pilot_subjects)) then
    perform makeup_private.fail('invalid', '이 과목은 아직 보강관리에서 다루지 않습니다');
  end if;

  if v_kind = 'attendance' then
    select ar.* into v_att from public.attendance_records ar
     where ar.id = v_source::uuid and ar.tenant_id = a.tenant_id;
    if not found or v_att.student_id <> v_student or v_att.class_id is distinct from v_class
       or v_att.session_date is distinct from v_date then
      perform makeup_private.fail('invalid', '결석 기록이 원수업과 맞지 않습니다 — 새로 고친 뒤 다시 접수해 주세요');
    end if;
    if v_att.status::text in ('present', 'late', 'early_leave', 'makeup') then
      perform makeup_private.fail('invalid', '출석으로 기록된 날입니다 — 결석으로 고친 뒤 접수해 주세요');
    end if;
    v_snapshot := jsonb_build_object('status', v_att.status, 'slot_start', v_att.slot_start,
      'session_units', v_att.session_units, 'recorded_at', v_att.recorded_at, 'supersedes_id', v_att.supersedes_id);
  else
    v_source := coalesce(v_source, p_cmd::text);
    v_snapshot := jsonb_build_object('reason', v_reason, 'received_by', a.user_id);
  end if;
  if v_owner is not null and not a.wide then v_owner := null; end if;
  perform makeup_private.assert_staff(a.tenant_id, v_owner);

  -- 같은 원수업의 동시 접수는 여기서 줄을 선다.
  perform makeup_private.lock_keys(a.tenant_id, array['occ:' || v_key]);
  select s.case_id into v_existing from public.makeup_case_sources s
   where s.tenant_id = a.tenant_id and s.source_kind = v_kind and s.source_id = v_source;
  if v_existing is not null then
    if (select c.occurrence_key from public.makeup_cases c where c.id = v_existing) <> v_key then
      perform makeup_private.fail('conflict', '이 기록은 이미 다른 보강 건에 연결되어 있습니다');
    end if;
  else
    select c.id into v_existing from public.makeup_cases c
     where c.tenant_id = a.tenant_id and c.occurrence_key = v_key;
  end if;

  if v_existing is null then
    insert into public.makeup_cases (tenant_id, student_id, subject_key, original_class_id, original_date,
        occurrence_key, reason, owner_id, due_date, note, absence_planned, created_by)
      values (a.tenant_id, v_student, v_subject, v_class, v_date, v_key, v_reason,
        coalesce(v_owner, case when not a.wide then a.user_id end), makeup_private.p_date(p, 'due_date'),
        left(makeup_private.p_text(p, 'note'), 1000), coalesce(v_date > a.today, false), a.user_id)
      returning * into v_case;
    v_new := true;
    perform makeup_private.log_event(a.tenant_id, 'case', v_case.id, 'intake', a.user_id, p_cmd, v_case.id, null,
      makeup_private.p_text(p, 'note'), jsonb_build_object('reason', v_reason, 'source_kind', v_kind), null, v_case.revision);
    perform makeup_private.audit(a, 'intake', '보강 접수', jsonb_build_object('command_id', p_cmd, 'case_id', v_case.id));
  else
    select * into v_case from public.makeup_cases c where c.id = v_existing for update;
  end if;

  insert into public.makeup_case_sources (tenant_id, case_id, source_kind, source_id, source_revision, snapshot,
      source_hash, created_by)
    values (a.tenant_id, v_case.id, v_kind, v_source, v_att.recorded_at::text, v_snapshot, md5(v_snapshot::text), a.user_id)
    on conflict (tenant_id, source_kind, source_id) do nothing;
  if found and not v_new then
    perform makeup_private.log_event(a.tenant_id, 'case', v_case.id, 'source_added', a.user_id, p_cmd, v_case.id, null,
      null, jsonb_build_object('source_kind', v_kind, 'source_id', v_source));
  end if;
  return makeup_private.result('intake', v_case.id, v_case.revision, 'case:' || v_key, array[v_case.id],
    jsonb_build_object('existing', not v_new));
end;
$$;

revoke all on all functions in schema makeup_private from public, anon, authenticated;
