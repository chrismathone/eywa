-- 0349d — 인계 관측: 종강 · 수강 종료/휴원 · 퇴원 · 담임 변경 뒤에도 열린 보강이 숨지 않게 한다
--
-- 🔴 열린 보강은 **그대로 보존**한다 — 반이 끝났거나 학생이 쉬거나 담임이 바뀌었다고 자동으로 취소·소멸·종결하지 않는다.
--    대신 인계 확인 항목(handover_review)을 열어 지점 전체 운영 권한이 담당자를 다시 정하게 한다. 사유가 사라지면 스스로 닫힌다.
-- 사유(detail.reasons):
--   student_withdrawn · student_on_hold      학생이 퇴원·휴원 상태
--   class_closed                             원수업 반이 폐지(is_active = false)되었거나 종강일이 지났다
--   enrollment_ended · enrollment_on_hold    원수업 반의 수강이 끝났거나(지금 유효한 수강 없음) 휴원 중
--   owner_out_of_scope                       담당자가 더는 그 반·학생을 맡지 않는다(담임·교시 담당 변경)
-- 권한 재검증: 명령·읽기는 항상 **지금** 담당 기준(0344a in_scope)이라 담임이 바뀌면 옛 담임은 그날로 범위를 잃는다
--   (담당자로 지정돼 있거나 그 회차의 강사면 그 건은 계속 본다 — 그래서 인계 항목이 필요하다).
-- 관측 지점: students(status) · enrollments(추가·변경·삭제) · classes(담임·폐지·종강) 저장 뒤. 그 학생·반에 열린 건이 없으면
--   조회 한 번으로 끝난다. 🔴 정규 저장을 **막지 않는다** — 안에서 오류가 나도 삼킨다(놓친 것은 대사 실행 0349e가 다시 본다).
-- 멱등: create or replace + drop trigger if exists.

create or replace function makeup_private.scan_handover(p_tenant uuid, p_student uuid default null, p_class uuid default null)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_c record;
  v_reasons text[];
  v_n integer := 0;
begin
  for v_c in
    select c.id, c.student_id, c.subject_key, c.original_class_id, c.owner_id,
           st.status::text as student_status, cl.is_active, cl.closed_at,
           (select u.system_role::text from public.users u where u.id = c.owner_id) as owner_role,
           exists (select 1 from public.enrollments e
                    where e.tenant_id = p_tenant and e.student_id = c.student_id and e.class_id = c.original_class_id
                      and e.start_date <= v_today and (e.end_date is null or e.end_date > v_today)) as enrolled,
           exists (select 1 from public.enrollments e
                    where e.tenant_id = p_tenant and e.student_id = c.student_id and e.class_id = c.original_class_id
                      and e.start_date <= v_today and (e.end_date is null or e.end_date > v_today) and e.on_hold) as held
      from public.makeup_cases c
      join public.students st on st.id = c.student_id
      left join public.classes cl on cl.id = c.original_class_id
     where c.tenant_id = p_tenant and c.lifecycle <> 'closed'
       and (p_student is null or c.student_id = p_student) and (p_class is null or c.original_class_id = p_class)
     order by c.id
  loop
    v_reasons := array_remove(array[
      case when v_c.student_status = 'withdrawn' then 'student_withdrawn' end,
      case when v_c.student_status = 'on_hold' then 'student_on_hold' end,
      case when v_c.original_class_id is not null and (not v_c.is_active or v_c.closed_at <= v_today) then 'class_closed' end,
      case when v_c.original_class_id is not null and not v_c.enrolled then 'enrollment_ended' end,
      case when v_c.held then 'enrollment_on_hold' end,
      case when v_c.owner_id is not null and v_c.owner_role = 'teacher'
                and not (coalesce(v_c.original_class_id in (select makeup_private.my_class_ids(p_tenant, v_c.owner_id, v_today)), false)
                         or exists (select 1 from public.enrollments e join public.classes k on k.id = e.class_id and k.subject = v_c.subject_key
                                     where e.tenant_id = p_tenant and e.student_id = v_c.student_id
                                       and e.start_date <= v_today and (e.end_date is null or e.end_date > v_today)
                                       and e.class_id in (select makeup_private.my_class_ids(p_tenant, v_c.owner_id, v_today)))
                         or exists (select 1 from public.makeup_allocations al
                                      join public.makeup_participants p on p.id = al.participant_id and p.status <> 'cancelled'
                                      join public.makeup_sessions s on s.id = p.session_id and s.state in ('confirmed', 'finished')
                                     where al.case_id = v_c.id and s.teacher_id = v_c.owner_id))
           then 'owner_out_of_scope' end], null);
    if cardinality(v_reasons) > 0 then
      perform makeup_private.open_recon(p_tenant, 'handover_review', 'handover:' || v_c.id::text, false, v_c.id, null, null, null, null,
        jsonb_build_object('reasons', to_jsonb(v_reasons), 'owner_id', v_c.owner_id, 'class_id', v_c.original_class_id));
      v_n := v_n + 1;
    else
      update public.makeup_reconciliation r
         set state = 'resolved', resolved_at = now(), resolution_note = '인계가 필요한 사유가 사라졌습니다',
             detail = r.detail || '{"auto_resolved": true}'::jsonb
       where r.tenant_id = p_tenant and r.dedupe_key = 'handover:' || v_c.id::text and r.state = 'open';
    end if;
  end loop;
  return v_n;
end;
$$;

create or replace function makeup_private.tg_observe_handover() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid; v_student uuid; v_class uuid;
begin
  begin
    if tg_table_name = 'students' then
      if old.status is not distinct from new.status then return null; end if;
      v_tenant := new.tenant_id; v_student := new.id;
    elsif tg_table_name = 'enrollments' then
      if tg_op = 'DELETE' then v_tenant := old.tenant_id; v_student := old.student_id;
      else v_tenant := new.tenant_id; v_student := new.student_id; end if;
    else
      if (old.teacher_id, old.is_active, old.closed_at) is not distinct from (new.teacher_id, new.is_active, new.closed_at) then return null; end if;
      v_tenant := new.tenant_id; v_class := new.id;
    end if;
    -- 그 학생·반에 열린 건이 없으면(대부분의 저장) 여기서 끝난다. 담임 변경은 담당자 범위에도 닿으므로 그 강사의 건도 본다.
    if exists (select 1 from public.makeup_cases c
                where c.tenant_id = v_tenant and c.lifecycle <> 'closed'
                  and (c.student_id = v_student or c.original_class_id = v_class)) then
      perform makeup_private.scan_handover(v_tenant, v_student, v_class);
    end if;
    -- (반 표일 때만 teacher_id 칸을 읽는다 — 한 식에 섞으면 다른 표의 저장에서 식 자체가 실패한다.)
    if v_class is not null then
      if old.teacher_id is distinct from new.teacher_id and old.teacher_id is not null then
        perform makeup_private.scan_handover(v_tenant, c.student_id, null)
           from (select distinct k.student_id from public.makeup_cases k
                  where k.tenant_id = v_tenant and k.lifecycle <> 'closed' and k.owner_id = old.teacher_id) c;
      end if;
    end if;
  exception when others then null;
  end;
  return null;
end;
$$;

drop trigger if exists students_makeup_observe_handover on public.students;
create trigger students_makeup_observe_handover
  after update on public.students for each row execute function makeup_private.tg_observe_handover();
drop trigger if exists enrollments_makeup_observe_handover on public.enrollments;
create trigger enrollments_makeup_observe_handover
  after insert or update or delete on public.enrollments for each row execute function makeup_private.tg_observe_handover();
drop trigger if exists classes_makeup_observe_handover on public.classes;
create trigger classes_makeup_observe_handover
  after update on public.classes for each row execute function makeup_private.tg_observe_handover();

revoke all on all functions in schema makeup_private from public, anon, authenticated;
