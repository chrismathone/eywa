-- 0348e — 읽기 RPC: 미연결 근거 public.makeup_candidates (아직 원장에 접수·연결되지 않은 결석과 기존 예약)
--
-- p_filter: {kind: absence(기본) | legacy, q(학생 이름), subject_key, date_from, date_to, page(1부터), page_size(기본 30 · 최대 100)}
-- 반환: {rows[{id, student_id, student_name, class_id, class_name, subject_key, original_date, session_date, status,
--              status_label}], total, page, page_size, date_from, date_to}
--   · absence — 유효 출결(정정 이력을 접은 최신)이 결석·인정결석이고, 그날 그 반에 시수 상태(출석·지각·조퇴·보강)의
--     유효 행이 없으며, 같은 원수업의 보강 건도 기존 예약도 아직 없는 날. id = 그 출결 행(접수의 source_id).
--   · legacy — 원장에 연결되지 않은 기존 예약(0264a). id = 예약 행(link_legacy의 source_id).
--   · 기간(date_from · date_to)은 **원수업 날짜** 기준이고 두 종류가 같이 쓴다. 🔴 숨은 기본 기간이 없다 — 기간을 주지 않으면
--     전 기간이다(오래된 결석이 조용히 빠지지 않는다). 적용한 값은 응답에 그대로 돌려준다(없으면 null).
--   · 세는 것과 자르는 것은 DB가 한다(count + offset/limit).
-- 첫 출시 대상 과목(유효 설정의 pilotSubjects)만. 범위: 지점 전체 읽기 권한이 아니면 지금 담당하는 반만.
-- 🔴 후보는 **제안**이다 — 여기 나왔다고 권리가 생기지 않는다(접수 = pending, 승인은 사람이 한다).
-- 🔴 꺼짐(off)이면 예외. 읽기 전용이다(출결·예약 행을 쓰지 않는다).
-- 멱등: create or replace.

drop function if exists makeup_private.candidate_rows(makeup_private.actor_ctx, text, text, text, date);
create or replace function makeup_private.candidate_rows(
  a makeup_private.actor_ctx, p_kind text, p_q text, p_subject text, p_from date, p_to date
) returns table (id uuid, student_id uuid, student_name text, class_id uuid, class_name text, subject_key text,
                 original_date date, session_date date, status text)
language sql stable security definer set search_path = public, pg_temp as $$
  with mine as (select makeup_private.my_class_ids(a.tenant_id, a.user_id, a.today) as class_id),
  absent as (
    select distinct on (ar.student_id, ar.class_id, ar.session_date)
           ar.id, ar.student_id, ar.class_id, ar.session_date as original_date, null::date as session_date, ar.status::text as status
      from public.attendance_records ar
      join public.classes c on c.id = ar.class_id and c.tenant_id = ar.tenant_id
     where p_kind = 'absence' and ar.tenant_id = a.tenant_id
       and (p_from is null or ar.session_date >= p_from) and (p_to is null or ar.session_date <= p_to)
       and ar.status::text in ('absent', 'excused') and c.subject = any (a.pilot_subjects)
       -- 유효 행: 같은 칸(학생·반·날짜·교시)에 더 나중에 찍힌 행이 없다.
       and not exists (
         select 1 from public.attendance_records n
          where n.tenant_id = ar.tenant_id and n.student_id = ar.student_id and n.class_id = ar.class_id
            and n.session_date = ar.session_date and n.slot_start is not distinct from ar.slot_start
            and (n.recorded_at, n.id) > (ar.recorded_at, ar.id))
       -- 그날 그 반에 시수 상태의 유효 행이 하나라도 있으면 결석한 날이 아니다.
       and not exists (
         select 1 from public.attendance_records p
          where p.tenant_id = ar.tenant_id and p.student_id = ar.student_id and p.class_id = ar.class_id
            and p.session_date = ar.session_date and p.status::text in ('present', 'late', 'early_leave', 'makeup')
            and not exists (
              select 1 from public.attendance_records n2
               where n2.tenant_id = p.tenant_id and n2.student_id = p.student_id and n2.class_id = p.class_id
                 and n2.session_date = p.session_date and n2.slot_start is not distinct from p.slot_start
                 and (n2.recorded_at, n2.id) > (p.recorded_at, p.id)))
       and not exists (
         select 1 from public.makeup_cases mc
          where mc.tenant_id = ar.tenant_id
            and mc.occurrence_key = 'day:' || ar.student_id::text || ':' || ar.class_id::text || ':' || to_char(ar.session_date, 'YYYY-MM-DD'))
       and not exists (
         select 1 from public.makeup_reservations r
          where r.tenant_id = ar.tenant_id and r.student_id = ar.student_id and r.class_id = ar.class_id
            and r.absence_date = ar.session_date)
     order by ar.student_id, ar.class_id, ar.session_date, ar.recorded_at desc, ar.id desc
  ), legacy as (
    select r.id, r.student_id, r.class_id, r.absence_date as original_date, r.makeup_date as session_date, r.status
      from public.makeup_reservations r
     where p_kind = 'legacy' and r.tenant_id = a.tenant_id
       and (p_from is null or r.absence_date >= p_from) and (p_to is null or r.absence_date <= p_to)
       and not exists (select 1 from public.makeup_legacy_maps m
                        where m.tenant_id = a.tenant_id and m.legacy_kind = 'reservation' and m.legacy_id = r.id and m.state = 'active')
  ), merged as (
    select * from absent union all select * from legacy
  )
  select m.id, m.student_id, s.name, m.class_id, c.class_name, c.subject, m.original_date, m.session_date, m.status
    from merged m
    -- 🔴 학생·반도 **이 지점의 것**일 때만 — 예약·출결의 FK는 id만 봐서 다른 지점의 학생·반을 가리키는 행이 있을 수 있다.
    join public.students s on s.id = m.student_id and s.tenant_id = a.tenant_id
    join public.classes c on c.id = m.class_id and c.tenant_id = a.tenant_id
   where c.subject = any (a.pilot_subjects) and (p_subject is null or c.subject = p_subject) and s.name ilike p_q
     and (makeup_private.can_read_all(a) or m.class_id in (select class_id from mine))
$$;

create or replace function public.makeup_candidates(p_filter jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  a makeup_private.actor_ctx := makeup_private.actor();
  f jsonb := coalesce(p_filter, '{}'::jsonb);
  v_kind text := coalesce(makeup_private.p_text(f, 'kind'), 'absence');
  v_from date := makeup_private.p_date(f, 'date_from');
  v_to date := makeup_private.p_date(f, 'date_to');
  v_q text := '%' || replace(replace(coalesce(makeup_private.p_text(f, 'q'), ''), '%', '\%'), '_', '\_') || '%';
  v_subject text := makeup_private.p_text(f, 'subject_key');
  v_page integer := greatest(coalesce(makeup_private.p_int(f, 'page'), 1), 1);
  v_size integer := least(greatest(coalesce(makeup_private.p_int(f, 'page_size'), 30), 1), 100);
  v_total integer;
  v_rows jsonb;
begin
  perform makeup_private.require_mode(a, 'read');
  if v_kind not in ('absence', 'legacy') then
    perform makeup_private.fail('invalid', '근거 종류가 올바르지 않습니다');
  end if;
  -- 날짜 칸에 값이 있는데 날짜가 아니면 전 기간으로 읽지 않고 거절한다(조건이 조용히 풀리지 않게).
  if (makeup_private.p_text(f, 'date_from') is not null and v_from is null)
     or (makeup_private.p_text(f, 'date_to') is not null and v_to is null) or v_from > v_to then
    perform makeup_private.fail('invalid', '조회 기간이 올바르지 않습니다');
  end if;
  select count(*) into v_total from makeup_private.candidate_rows(a, v_kind, v_q, v_subject, v_from, v_to);
  -- 값이 없는 칸(결석 후보의 예정 일정)은 키째 뺀다.
  select coalesce(jsonb_agg(jsonb_strip_nulls(to_jsonb(k) || jsonb_build_object('status_label',
      case k.status when 'reserved' then '예약' when 'done' then '이행' else makeup_private.status_label(k.status) end))
      order by k.original_date desc, k.student_name, k.id), '[]'::jsonb)
    into v_rows
    from (select r.* from makeup_private.candidate_rows(a, v_kind, v_q, v_subject, v_from, v_to) r
           order by r.original_date desc, r.student_name, r.id offset (v_page - 1) * v_size limit v_size) k;
  return jsonb_build_object('total', v_total, 'page', v_page, 'page_size', v_size, 'date_from', v_from, 'date_to', v_to, 'rows', v_rows);
end;
$$;

revoke all on function public.makeup_candidates(jsonb) from public, anon, service_role;
grant execute on function public.makeup_candidates(jsonb) to authenticated;
revoke all on all functions in schema makeup_private from public, anon, authenticated;
notify pgrst, 'reload schema';
