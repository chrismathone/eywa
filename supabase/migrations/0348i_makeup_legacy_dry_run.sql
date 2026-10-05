-- 0348i — 읽기 RPC: 기존 예약 가져오기 미리 보기 public.makeup_legacy_dry_run (운영 쓰기 0)
--
-- 아직 원장에 연결되지 않은 기존 예약(0264a)을 **연결하면 어떻게 읽힐지** 미리 보여 준다. 아무것도 쓰지 않는다(STABLE 함수 —
-- 쓰기 문장을 실행할 수 없다). 여기 나왔다고 권리·인정이 생기지 않는다: 연결은 사람이 link_legacy 명령으로 한 건씩 한다.
--   p_filter: {q(학생 이름), subject_key, date_from, date_to(원수업일), page(1부터), page_size(기본 50 · 최대 200)}
--   반환: {rows[], total, page, page_size, counts{A,B,C,D,E}, writes: 0}  — counts는 조건 전체의 등급별 수(합 = total).
--   rows: {id, student_id, student_name, class_id, class_name, subject_key, original_date, session_date, status, status_label,
--          source_hash, occurrence_key, evidence_grade, duplicate_count, review_note}
--     · source_hash = md5((예약 행 jsonb − updated_at)::text) — link_legacy가 연결할 때 찍는 스냅샷 체크섬과 같은 식.
--       연결 명령에 expected_source_hash로 넘기면, 미리 본 뒤 예약이 바뀐 경우 아무것도 쓰기 전에 거절된다(0346i).
--     · occurrence_key = day:<학생>:<원반>:<원수업일> — 연결하면 이 원사건의 건에 붙는다.
--     · duplicate_count = 같은 원사건(학생·원반·원수업일)의 **다른** 예약 수(연결 여부 무관).
--     · evidence_grade — 하나만 붙는다. 우선순위 E → D → B / A / C:
--         E  반이 폐지·종강됐거나, 학생이 퇴원·휴원이거나, 그 반 수강이 끝났거나 휴원 중
--         D  같은 원사건에 예약이 여럿(나눠 잡음)이거나, 그 원사건의 보강 건이 원장에 이미 있다
--         B  이행(done)으로 표시됐고 근거가 **둘 다** 확인된다 — ① 예약에 연결된 출결 행이 그 칸(같은 지점·학생·반·보강일)의
--            최신 유효 행이고 시수 상태, ② 그날의 유효한 보강 보고서: 연결 때와 같은 판정(0345d report_issue — 반 없는 보강
--            보고서 · 같은 과목 · 보강 반 = 그 반 · 처리 중/회수 아님) + 발송 전이거나 보낸 것(발송 실패·대기는 제외) +
--            작성자가 실제 강사(출결의 귀속 강사, 없으면 그날 그 반 담당) + 다른 보강에 이미 연결되지 않음.
--            하나만 있으면 C다. 검토 후보일 뿐이다(자동 인정 없음).
--         A  아직 오지 않은 예약(reserved) — 일정 그대로 옮길 수 있다
--         C  그 밖: 이행으로 표시됐지만 근거가 하나뿐이거나 없음 · 보강일이 지났는데 이행 기록 없음 · 메모에 취소·변경 표현
--       확인하지 못한 것을 B로 올리지 않는다 — C로 두고 review_note에 까닭을 적는다.
-- 대상 과목·범위·꺼짐 처리는 makeup_candidates와 같다(첫 운영 과목만 · 지점 전체 읽기 권한이 아니면 지금 담당 반만 · off면 예외).
-- 🔴 예약 표의 FK는 학생·반의 id만 본다(지점을 묶지 않는다). 그래서 예약·학생·반이 **모두 같은 지점**일 때만 내보낸다 —
--    다른 지점의 학생·반을 가리키는 예약(오래된 데이터·조작)은 이름도 번호도 나가지 않는다. 연결 명령도 거절한다(0346i).
-- 멱등: create or replace.

create or replace function makeup_private.dry_run_rows(
  a makeup_private.actor_ctx, p_q text, p_subject text, p_from date, p_to date
) returns table (id uuid, student_id uuid, student_name text, class_id uuid, class_name text, subject_key text, original_date date,
                 session_date date, status text, source_hash text, occurrence_key text, evidence_grade text,
                 duplicate_count integer, review_note text)
language sql stable security definer set search_path = public, pg_temp as $$
  with mine as (select makeup_private.my_class_ids(a.tenant_id, a.user_id, a.today) as class_id),
  base as (
    select r, s.name as student_name, s.status::text as student_status, c.class_name, c.subject, c.is_active, c.closed_at
      from public.makeup_reservations r
      join public.students s on s.id = r.student_id and s.tenant_id = r.tenant_id
      join public.classes c on c.id = r.class_id and c.tenant_id = r.tenant_id
     where r.tenant_id = a.tenant_id and c.subject = any (a.pilot_subjects) and (p_subject is null or c.subject = p_subject)
       and s.name ilike p_q and (p_from is null or r.absence_date >= p_from) and (p_to is null or r.absence_date <= p_to)
       and (makeup_private.can_read_all(a) or r.class_id in (select class_id from mine))
       and not exists (select 1 from public.makeup_legacy_maps m
                        where m.tenant_id = a.tenant_id and m.legacy_kind = 'reservation' and m.legacy_id = r.id and m.state = 'active')
  ), facts as (
    select b.*,
      'day:' || (b.r).student_id::text || ':' || (b.r).class_id::text || ':' || to_char((b.r).absence_date, 'YYYY-MM-DD') as occ,
      (select count(*)::integer from public.makeup_reservations o
        where o.tenant_id = a.tenant_id and o.student_id = (b.r).student_id and o.class_id = (b.r).class_id
          and o.absence_date = (b.r).absence_date and o.id <> (b.r).id) as dup,
      exists (select 1 from public.enrollments e
               where e.tenant_id = a.tenant_id and e.student_id = (b.r).student_id and e.class_id = (b.r).class_id
                 and e.start_date <= a.today and (e.end_date is null or e.end_date > a.today) and not e.on_hold) as enrolled,
      att.id is not null as att_ok,
      -- 유효한 보강 보고서: 연결 때와 같은 판정 + 발송 전/보낸 것만 + 작성자가 실제 강사(귀속 강사, 없으면 그날 그 반 담당).
      exists (select 1 from public.lesson_reports lr
               where lr.tenant_id = a.tenant_id and lr.student_id = (b.r).student_id and lr.report_date = (b.r).makeup_date
                 and lr.created_by is not null and coalesce(lr.classnote_status, 'success') = 'success'
                 and makeup_private.report_issue(a.tenant_id, lr.id, jsonb_populate_record(null::public.makeup_participants,
                       jsonb_build_object('student_id', (b.r).student_id, 'session_date', (b.r).makeup_date, 'subject_key', b.subject,
                         'anchor_class_id', (b.r).class_id)), lr.created_by) is null
                 and exists (select 1 from public.users u
                              where u.id = lr.created_by and u.tenant_id = a.tenant_id and u.system_role::text <> 'student')
                 -- 이미 다른 보강의 실시 기록에 연결된 보고서는 이 예약의 근거가 될 수 없다(한 보고서 = 한 참여).
                 and not exists (select 1 from public.makeup_fulfillments f
                                  where f.tenant_id = a.tenant_id and f.report_id = lr.id and f.state <> 'reversed')
                 and case when att.taught_by is not null then lr.created_by = att.taught_by
                          else (b.r).class_id in (select makeup_private.my_class_ids(a.tenant_id, lr.created_by, (b.r).makeup_date)) end) as report_ok,
      exists (select 1 from public.lesson_reports lr
               where lr.tenant_id = a.tenant_id and lr.student_id = (b.r).student_id and lr.report_date = (b.r).makeup_date
                 and lr.subject = b.subject) as report_any
    from base b
    -- 예약에 연결된 출결 행이 그 칸(같은 지점·학생·반·보강일)의 최신 유효 행이고 시수 상태일 때만 잡힌다.
    left join lateral (
      select ar.id, (to_jsonb(ar) ->> 'taught_by')::uuid as taught_by from public.attendance_records ar
       where ar.id = (b.r).attendance_record_id and ar.tenant_id = a.tenant_id and ar.student_id = (b.r).student_id
         and ar.class_id = (b.r).class_id and ar.session_date = (b.r).makeup_date
         and ar.status::text in ('present', 'late', 'early_leave', 'makeup')
         and not exists (select 1 from public.attendance_records n
                          where n.tenant_id = ar.tenant_id and n.student_id = ar.student_id and n.class_id = ar.class_id
                            and n.session_date = ar.session_date and n.slot_start is not distinct from ar.slot_start
                            and (n.recorded_at, n.id) > (ar.recorded_at, ar.id))) att on true
  ), graded as (
    select f.*,
      exists (select 1 from public.makeup_cases mc where mc.tenant_id = a.tenant_id and mc.occurrence_key = f.occ) as has_case,
      (not f.is_active or f.closed_at <= a.today) as class_gone,
      coalesce((f.r).note, '') ~ '(취소|변경|미정|보류)' as memo_doubt
    from facts f
  )
  select (g.r).id, (g.r).student_id, g.student_name, (g.r).class_id, g.class_name, g.subject, (g.r).absence_date, (g.r).makeup_date,
    (g.r).status, md5((to_jsonb(g.r) - 'updated_at')::text), g.occ,
    case when g.class_gone or g.student_status in ('withdrawn', 'on_hold') or not g.enrolled then 'E'
         when g.dup > 0 or g.has_case then 'D'
         when (g.r).status = 'done' and g.att_ok and g.report_ok then 'B'
         when (g.r).status = 'reserved' and (g.r).makeup_date >= a.today and not g.memo_doubt then 'A'
         else 'C' end,
    g.dup,
    -- 해당하는 까닭을 전부 적는다(등급은 그중 가장 앞선 하나).
    coalesce(nullif(concat_ws(' · ',
      case when g.class_gone then '폐지되었거나 종강한 반입니다' end,
      case when g.student_status = 'withdrawn' then '퇴원한 학생입니다' when g.student_status = 'on_hold' then '휴원 중인 학생입니다' end,
      case when not g.enrolled then '이 반의 수강이 끝났거나 휴원 중입니다' end,
      case when g.dup > 0 then '같은 원수업에 예약이 ' || g.dup || '건 더 있습니다' end,
      case when g.has_case then '이 원수업의 보강 건이 이미 있습니다' end,
      case when (g.r).status <> 'done' then null
           when g.att_ok and g.report_ok then '이행으로 표시됐고 그날 출결 기록과 보강 보고서가 모두 확인됩니다 — 검토 후보입니다'
           when g.att_ok and g.report_any then '출결은 확인되지만 보강 보고서를 근거로 쓸 수 없습니다(회수·처리 중·작성자·보강 반 확인 필요)'
           when g.att_ok then '출결은 확인되지만 보강 보고서가 없습니다'
           when g.report_ok then '보강 보고서는 있지만 연결된 유효한 출결 기록을 확인하지 못했습니다'
           else '이행으로 표시됐지만 근거(출결 기록·보강 보고서)를 확인하지 못했습니다' end,
      case when (g.r).status = 'reserved' and (g.r).makeup_date < a.today then '보강일이 지났는데 이행 기록이 없습니다' end,
      case when g.memo_doubt then '메모에 취소·변경 표현이 있어 사람이 확인해야 합니다' end), ''),
      '일정 그대로 연결할 수 있습니다 — 승인은 따로 합니다')
  from graded g
$$;

create or replace function public.makeup_legacy_dry_run(p_filter jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  a makeup_private.actor_ctx := makeup_private.actor();
  f jsonb := coalesce(p_filter, '{}'::jsonb);
  v_from date := makeup_private.p_date(f, 'date_from');
  v_to date := makeup_private.p_date(f, 'date_to');
  v_q text := '%' || replace(replace(coalesce(makeup_private.p_text(f, 'q'), ''), '%', '\%'), '_', '\_') || '%';
  v_page integer := greatest(coalesce(makeup_private.p_int(f, 'page'), 1), 1);
  v_size integer := least(greatest(coalesce(makeup_private.p_int(f, 'page_size'), 50), 1), 200);
  v_out jsonb;
begin
  perform makeup_private.require_mode(a, 'read');
  if (makeup_private.p_text(f, 'date_from') is not null and v_from is null)
     or (makeup_private.p_text(f, 'date_to') is not null and v_to is null) or v_from > v_to then
    perform makeup_private.fail('invalid', '조회 기간이 올바르지 않습니다');
  end if;
  with found as materialized (
    select d.* from makeup_private.dry_run_rows(a, v_q, makeup_private.p_text(f, 'subject_key'), v_from, v_to) d
  )
  select jsonb_build_object('writes', 0, 'page', v_page, 'page_size', v_size, 'total', (select count(*) from found),
    'counts', (select jsonb_build_object('A', count(*) filter (where evidence_grade = 'A'), 'B', count(*) filter (where evidence_grade = 'B'),
        'C', count(*) filter (where evidence_grade = 'C'), 'D', count(*) filter (where evidence_grade = 'D'),
        'E', count(*) filter (where evidence_grade = 'E')) from found),
    'rows', coalesce((select jsonb_agg(to_jsonb(k) || jsonb_build_object('status_label', case k.status when 'done' then '이행' else '예약' end)
                               order by k.original_date desc, k.student_name, k.id)
                        from (select x.* from found x order by x.original_date desc, x.student_name, x.id
                               offset (v_page - 1) * v_size limit v_size) k), '[]'::jsonb))
    into v_out;
  return v_out;
end;
$$;

revoke all on function public.makeup_legacy_dry_run(jsonb) from public, anon, service_role;
grant execute on function public.makeup_legacy_dry_run(jsonb) to authenticated;
revoke all on all functions in schema makeup_private from public, anon, authenticated;
notify pgrst, 'reload schema';
