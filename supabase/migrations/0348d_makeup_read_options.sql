-- 0348d — 읽기 RPC: 선택지 public.makeup_options (보강관리 화면의 검색형 선택 상자)
--
-- 화면이 학생·반·직원·강의실·정책·출결 기록·보고서·합류할 회차를 고를 때 쓰는 한 문.
--   p_filter: {kind, q, subject_key, student_id, session_date, class_id, page(1부터), page_size(기본 30 · 최대 50)}
--   반환: {rows[{id, name, …}], total, page, page_size}  — name은 화면에 그대로 찍는 한글 표기다(상태 코드를 내보내지 않는다).
--   kind:
--     students   지금 그 과목 반에 다니는 학생(강사 범위는 지금 담당 반의 학생만)
--     classes    그 과목의 운영 중인 반(강사 범위는 지금 담당 반 + 고를 수 있는 그 학생이 다니는 반)
--     staff      재직 직원(강사 범위는 **본인만** — 다른 직원 명단을 내주지 않는다) · classrooms 강의실(정원 표기)
--     policies   정책 버전(원장·관리자만 — 그 밖의 계정은 거절)
--     attendance 그 학생의 유효 출결 행(정정 이력을 접은 최신) — student_id 필수
--     reports    그 학생의 수업 보고서 — student_id 필수. linkable = 보강 근거로 연결할 수 있는 모양(반 없는 보강 보고서)인가
--   세는 것과 자르는 것은 DB가 한다(count + offset/limit) — 전체를 JSON으로 모은 뒤 자르지 않는다.
--     sessions   합류할 수 있는 확정 회차(오늘 이후)
-- 범위: 지점 전체 읽기 권한이 아니면 학생·출결·보고서는 지금 담당하는 학생(같은 과목 반) 또는 내가 맡은 회차의 학생만.
-- 🔴 꺼짐(off)이면 예외. 연락처·수납·급여·상담 내용은 싣지 않는다.
-- 멱등: create or replace.

create or replace function makeup_private.status_label(p_status text) returns text
language sql immutable set search_path = pg_catalog as $$
  select case p_status when 'present' then '출석' when 'absent' then '결석' when 'late' then '지각'
    when 'excused' then '인정결석' when 'makeup' then '보강' when 'early_leave' then '조퇴' else '기타' end
$$;

-- 이 학생의 출결·보고서를 이 계정이 고를 수 있는가.
create or replace function makeup_private.can_pick_student(a makeup_private.actor_ctx, p_student uuid, p_subject text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select makeup_private.can_read_all(a)
      or makeup_private.teaches_student(a, p_student, p_subject)
      or exists (select 1 from public.makeup_participants p join public.makeup_sessions s on s.id = p.session_id
                  where p.tenant_id = a.tenant_id and p.student_id = p_student and s.teacher_id = a.user_id
                    and p.status <> 'cancelled')
$$;

-- 종류별 선택지 집합(정렬 키 포함). 세고 자르는 것은 makeup_options가 한다.
drop function if exists makeup_private.option_rows(makeup_private.actor_ctx, text, text, text, uuid, date, uuid);
create or replace function makeup_private.option_rows(
  a makeup_private.actor_ctx, p_kind text, p_q text, p_subject text, p_student uuid, p_date date, p_class uuid
) returns table (sort1 text, sort2 text, id uuid, name text, extra jsonb)
language sql stable security definer set search_path = public, pg_temp as $$
  with mine as (select makeup_private.my_class_ids(a.tenant_id, a.user_id, a.today) as class_id),
  picked as (
    select s.name as sort1, s.id::text as sort2, s.id, s.name, '{}'::jsonb as extra
      from public.students s
     where p_kind = 'students' and s.tenant_id = a.tenant_id and s.name ilike p_q
       and exists (select 1 from public.enrollments e join public.classes c on c.id = e.class_id
                    where e.student_id = s.id and e.tenant_id = a.tenant_id
                      and e.start_date <= a.today and (e.end_date is null or e.end_date > a.today)
                      and (p_subject is null or c.subject = p_subject) and (p_class is null or c.id = p_class)
                      and (makeup_private.can_read_all(a) or c.id in (select class_id from mine)))
    union all
    select c.class_name, c.id::text, c.id, c.class_name, jsonb_build_object('subject_key', c.subject, 'teacher_id', c.teacher_id)
      from public.classes c
     where p_kind = 'classes' and c.tenant_id = a.tenant_id and c.is_active and c.class_name ilike p_q
       and (p_subject is null or c.subject = p_subject)
       and (p_student is null or exists (select 1 from public.enrollments e
                                          where e.class_id = c.id and e.student_id = p_student and e.tenant_id = a.tenant_id))
       and (makeup_private.can_read_all(a) or c.id in (select class_id from mine)
            or (p_student is not null and makeup_private.can_pick_student(a, p_student, c.subject)
                and exists (select 1 from public.enrollments e where e.class_id = c.id and e.student_id = p_student)))
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
  v_total integer;
  v_rows jsonb;
begin
  perform makeup_private.require_mode(a, 'read');
  if v_kind is null or v_kind not in ('students', 'classes', 'staff', 'classrooms', 'policies', 'attendance', 'reports', 'sessions') then
    perform makeup_private.fail('invalid', '선택지 종류가 올바르지 않습니다');
  end if;
  if v_kind in ('attendance', 'reports') and (v_student is null or not makeup_private.can_pick_student(a, v_student, v_subject)) then
    perform makeup_private.fail('forbidden', '담당하는 학생의 기록만 고를 수 있습니다');
  end if;
  if v_kind = 'policies' and not a.privileged then
    perform makeup_private.fail('forbidden', '정책은 승인 권한이 있는 관리자만 볼 수 있습니다');
  end if;
  select count(*) into v_total from makeup_private.option_rows(a, v_kind, v_q, v_subject, v_student, v_date, v_class);
  select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'name', k.name) || k.extra order by k.sort1, k.sort2), '[]'::jsonb)
    into v_rows
    from (select o.* from makeup_private.option_rows(a, v_kind, v_q, v_subject, v_student, v_date, v_class) o
           order by o.sort1, o.sort2 offset (v_page - 1) * v_size limit v_size) k;
  return jsonb_build_object('total', v_total, 'page', v_page, 'page_size', v_size, 'rows', v_rows);
end;
$$;

revoke all on function public.makeup_options(jsonb) from public, anon, service_role;
grant execute on function public.makeup_options(jsonb) to authenticated;
revoke all on all functions in schema makeup_private from public, anon, authenticated;
notify pgrst, 'reload schema';
