-- 0350c — 선택지 public.makeup_options: 동명이인을 가르는 단서 · 학생과 날짜에 맞는 반 후보(purpose)
--
-- 0348d의 option_rows · makeup_options를 바꿔 끼운다(칸과 조건만 더한다 — 옛 호출은 그대로 같은 결과를 받는다).
--   students  줄마다 school · grade · class_names(지금 다니는 같은 과목 반 이름, 이름순 최대 3개)를 더 준다. name은 그대로다.
--             class_names는 이 계정이 이미 볼 수 있는 반만 싣는다(강사 범위는 지금 담당 반). 연락처·보호자는 싣지 않는다.
--   classes   p_filter.purpose가 있으면 student_id · session_date가 꼭 있어야 한다(없으면 거절 — 조건 없이 전체를 내주지 않는다).
--     purpose = 'anchor'    출결·보고서를 세울 반. 0345c resolve_anchor와 같은 조건:
--                           같은 과목 · 운영 중 · 그날 종강 전 · 그날 그 학생이 다니는 반.
--     purpose = 'original'  접수할 원수업 반. 0346a cmd_intake와 같은 조건: 그날 그 반의 수강생.
--                           🔴 지금은 종료된 반도 나온다(이름 뒤에 표시) — 접수는 받아 주는데 고를 수 없던 것을 맞춘다.
--                           지점 전체 읽기가 아니면 지금 담당 반만(접수가 담당 반의 결석만 받는 것과 같다).
--     purpose 없음           종전 그대로(그 과목의 운영 중인 반).
--     줄마다 active(운영 중인 반인가)를 더 준다.
-- 판정은 여전히 명령이 한다 — 여기는 고를 수 있는 것을 미리 좁혀 줄 뿐이다.
-- 🔴 꺼짐(off)이면 예외. 표를 쓰지 않는다.
-- 🔴 0348d를 손으로 다시 실행했으면 이 파일도 다시 실행한다(뒤에 실행한 정의가 남는다).
-- 멱등: create or replace. 인자가 하나 늘어 옛 정의(인자 7개)는 맨 끝에서 지운다.

create or replace function makeup_private.option_rows(
  a makeup_private.actor_ctx, p_kind text, p_q text, p_subject text, p_student uuid, p_date date, p_class uuid, p_purpose text
) returns table (sort1 text, sort2 text, id uuid, name text, extra jsonb)
language sql stable security definer set search_path = public, pg_temp as $$
  with mine as (select makeup_private.my_class_ids(a.tenant_id, a.user_id, a.today) as class_id),
  picked as (
    select s.name as sort1, s.id::text as sort2, s.id, s.name,
           jsonb_build_object('school', s.school, 'grade', s.grade, 'class_names', coalesce((
             select jsonb_agg(x.class_name order by x.class_name) from (
               select distinct c.class_name from public.enrollments e join public.classes c on c.id = e.class_id
                where e.student_id = s.id and e.tenant_id = a.tenant_id
                  and e.start_date <= a.today and (e.end_date is null or e.end_date > a.today)
                  and (p_subject is null or c.subject = p_subject)
                  and (makeup_private.can_read_all(a) or c.id in (select class_id from mine))
                order by c.class_name limit 3) x), '[]'::jsonb)) as extra
      from public.students s
     where p_kind = 'students' and s.tenant_id = a.tenant_id and s.name ilike p_q
       and exists (select 1 from public.enrollments e join public.classes c on c.id = e.class_id
                    where e.student_id = s.id and e.tenant_id = a.tenant_id
                      and e.start_date <= a.today and (e.end_date is null or e.end_date > a.today)
                      and (p_subject is null or c.subject = p_subject) and (p_class is null or c.id = p_class)
                      and (makeup_private.can_read_all(a) or c.id in (select class_id from mine)))
    union all
    select c.class_name, c.id::text, c.id,
           c.class_name || case when p_purpose = 'original' and not c.is_active then ' (종료된 반)' else '' end,
           jsonb_build_object('subject_key', c.subject, 'teacher_id', c.teacher_id, 'active', c.is_active)
      from public.classes c
     where p_kind = 'classes' and c.tenant_id = a.tenant_id and c.class_name ilike p_q
       and (p_subject is null or c.subject = p_subject)
       and case p_purpose
             when 'original' then
               exists (select 1 from public.enrollments e
                        where e.tenant_id = a.tenant_id and e.class_id = c.id and e.student_id = p_student
                          and e.start_date <= p_date and (e.end_date is null or e.end_date > p_date))
               and (makeup_private.can_read_all(a) or c.id in (select class_id from mine))
             when 'anchor' then
               c.is_active and (c.closed_at is null or c.closed_at >= p_date)
               and exists (select 1 from public.enrollments e
                            where e.tenant_id = a.tenant_id and e.class_id = c.id and e.student_id = p_student
                              and e.start_date <= p_date and (e.end_date is null or e.end_date > p_date))
               and (makeup_private.can_read_all(a) or c.id in (select class_id from mine)
                    or makeup_private.can_pick_student(a, p_student, c.subject))
             else
               c.is_active
               and (p_student is null or exists (select 1 from public.enrollments e
                                                  where e.class_id = c.id and e.student_id = p_student and e.tenant_id = a.tenant_id))
               and (makeup_private.can_read_all(a) or c.id in (select class_id from mine)
                    or (p_student is not null and makeup_private.can_pick_student(a, p_student, c.subject)
                        and exists (select 1 from public.enrollments e where e.class_id = c.id and e.student_id = p_student)))
           end
    union all
    select u.display_name, u.id::text, u.id, u.display_name, '{}'::jsonb
      from public.users u
     where p_kind = 'staff' and u.tenant_id = a.tenant_id and u.status = 'active'
       and u.system_role::text <> 'student' and u.display_name ilike p_q
       and (makeup_private.can_read_all(a) or u.id = a.user_id)
    union all
    select r.name, r.id::text, r.id,
           r.name || case when r.capacity is null then ' (정원 미설정)' else ' (정원 ' || r.capacity || '명)' end,
           jsonb_build_object('capacity', r.capacity)
      from public.classrooms r where p_kind = 'classrooms' and r.tenant_id = a.tenant_id and r.name ilike p_q
    union all
    select to_char(date '9999-12-31' - pv.effective_from, 'FM0000000'), to_char(999999999999 - extract(epoch from pv.created_at), 'FM000000000000'),
           pv.id, pv.label || ' (' || to_char(pv.effective_from, 'YYYY-MM-DD') || '부터)',
           jsonb_build_object('effective_from', pv.effective_from, 'self_verify', pv.self_verify, 'additional_billing', pv.additional_billing)
      from public.makeup_policy_versions pv
     where p_kind = 'policies' and a.privileged and pv.tenant_id = a.tenant_id and pv.label ilike p_q
    union all
    select to_char(date '9999-12-31' - x.session_date, 'FM0000000'), to_char(999999999999 - extract(epoch from x.recorded_at), 'FM000000000000'),
           x.id, to_char(x.session_date, 'MM-DD') || ' ' || x.class_name || ' · ' || makeup_private.status_label(x.status)
             || coalesce(' · 시수 ' || x.session_units, ''),
           jsonb_build_object('session_date', x.session_date, 'class_id', x.class_id, 'session_units', x.session_units)
      from (select distinct on (ar.class_id, ar.session_date, ar.slot_start) ar.id, ar.session_date, ar.recorded_at,
                   ar.class_id, ar.status::text as status, ar.session_units, c.class_name
              from public.attendance_records ar join public.classes c on c.id = ar.class_id
             where p_kind = 'attendance' and ar.tenant_id = a.tenant_id and ar.student_id = p_student
               and (p_date is null or ar.session_date = p_date) and (p_class is null or ar.class_id = p_class)
               and (p_subject is null or c.subject = p_subject)
             order by ar.class_id, ar.session_date, ar.slot_start, ar.recorded_at desc, ar.id desc) x
     where x.class_name ilike p_q
    union all
    select to_char(date '9999-12-31' - lr.report_date, 'FM0000000'), lr.id::text, lr.id,
           to_char(lr.report_date, 'MM-DD') || ' ' || coalesce(c.class_name, '반 없는 보고서')
             || coalesce(' · ' || nullif(lr.teacher_name, ''), '') || case when lr.makeup then ' · 보강' else '' end,
           jsonb_build_object('report_date', lr.report_date, 'class_id', lr.class_id, 'makeup', lr.makeup,
             'linkable', lr.class_id is null and lr.makeup)
      from public.lesson_reports lr left join public.classes c on c.id = lr.class_id
     where p_kind = 'reports' and lr.tenant_id = a.tenant_id and lr.student_id = p_student
       and (p_date is null or lr.report_date = p_date)
       and (p_subject is null or coalesce(lr.subject, c.subject) = p_subject)
       and coalesce(c.class_name, '') ilike p_q
    union all
    select to_char(s.session_date, 'YYYY-MM-DD') || to_char(s.start_time, 'HH24:MI'), s.id::text, s.id,
           to_char(s.session_date, 'MM-DD') || ' ' || to_char(s.start_time, 'HH24:MI') || '~' || to_char(s.end_time, 'HH24:MI')
             || coalesce(' · ' || u.display_name, '') || coalesce(' · ' || r.name, '')
             || ' (' || (select count(*) from public.makeup_participants p where p.session_id = s.id and p.status <> 'cancelled')
             || '/' || coalesce(s.capacity::text, '-') || '명)',
           makeup_private.session_json(s.id)
      from public.makeup_sessions s
      left join public.users u on u.id = s.teacher_id
      left join public.classrooms r on r.id = s.classroom_id
     where p_kind = 'sessions' and s.tenant_id = a.tenant_id and s.state = 'confirmed' and s.session_date >= a.today
       and not s.imported and (p_subject is null or s.subject_key = p_subject) and (p_date is null or s.session_date = p_date)
       and (makeup_private.can_read_all(a) or s.teacher_id = a.user_id) and coalesce(u.display_name, '') ilike p_q
  )
  select k.sort1, k.sort2, k.id, k.name, k.extra from picked k
$$;

create or replace function public.makeup_options(p_filter jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  a makeup_private.actor_ctx := makeup_private.actor();
  f jsonb := coalesce(p_filter, '{}'::jsonb);
  v_kind text := makeup_private.p_text(f, 'kind');
  v_subject text := makeup_private.p_text(f, 'subject_key');
  v_student uuid := makeup_private.p_uuid(f, 'student_id');
  v_page integer := greatest(coalesce(makeup_private.p_int(f, 'page'), 1), 1);
  v_size integer := least(greatest(coalesce(makeup_private.p_int(f, 'page_size'), 30), 1), 50);
  v_q text := '%' || replace(replace(coalesce(makeup_private.p_text(f, 'q'), ''), '%', '\%'), '_', '\_') || '%';
  v_date date := makeup_private.p_date(f, 'session_date');
  v_class uuid := makeup_private.p_uuid(f, 'class_id');
  v_purpose text := makeup_private.p_text(f, 'purpose');
  v_total integer;
  v_rows jsonb;
begin
  perform makeup_private.require_mode(a, 'read');
  if v_kind is null or v_kind not in ('students', 'classes', 'staff', 'classrooms', 'policies', 'attendance', 'reports', 'sessions') then
    perform makeup_private.fail('invalid', '선택지 종류가 올바르지 않습니다');
  end if;
  if v_purpose is not null and (v_kind <> 'classes' or v_purpose not in ('anchor', 'original') or v_student is null or v_date is null) then
    perform makeup_private.fail('invalid', '학생과 날짜를 먼저 고른 뒤 반을 찾아 주세요');
  end if;
  if v_kind in ('attendance', 'reports') and (v_student is null or not makeup_private.can_pick_student(a, v_student, v_subject)) then
    perform makeup_private.fail('forbidden', '담당하는 학생의 기록만 고를 수 있습니다');
  end if;
  if v_kind = 'policies' and not a.privileged then
    perform makeup_private.fail('forbidden', '정책은 승인 권한이 있는 관리자만 볼 수 있습니다');
  end if;
  select count(*) into v_total from makeup_private.option_rows(a, v_kind, v_q, v_subject, v_student, v_date, v_class, v_purpose);
  select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'name', k.name) || k.extra order by k.sort1, k.sort2), '[]'::jsonb)
    into v_rows
    from (select o.* from makeup_private.option_rows(a, v_kind, v_q, v_subject, v_student, v_date, v_class, v_purpose) o
           order by o.sort1, o.sort2 offset (v_page - 1) * v_size limit v_size) k;
  return jsonb_build_object('total', v_total, 'page', v_page, 'page_size', v_size, 'rows', v_rows);
end;
$$;

drop function if exists makeup_private.option_rows(makeup_private.actor_ctx, text, text, text, uuid, date, uuid);

revoke all on function public.makeup_options(jsonb) from public, anon, service_role;
grant execute on function public.makeup_options(jsonb) to authenticated;
revoke all on all functions in schema makeup_private from public, anon, authenticated;
notify pgrst, 'reload schema';
