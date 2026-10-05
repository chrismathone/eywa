-- 0348c — 읽기 RPC: 참여 명단 public.makeup_list_participants  (확인 필요 목록·변경 이력은 0348g)
--
-- 출석부·원스크린·시간표·영상 숙제 등 기존 화면의 어댑터가 "그날 그 학생의 보강 참여"를 읽는 문.
-- 케이스 목록이 비었다고 "참여 없음"으로 읽지 않도록 따로 둔다.
--   p_filter: {student_id, student_ids[], subject_key, session_date, date_from, date_to, class_id, teacher_id,
--              legacy_reservation_ids[], include_cancelled(기본 false),
--              limit 또는 page_size(기본 200 · 최대 500), page(1부터), after{session_date, start_time, id}}
--   반환: {mode, participants[], legacy_maps[], truncated, total, page, page_size, next_after}
-- 🔴 넘겨 읽기 — 하루에 500명이 넘어도 전부 읽을 수 있어야 한다(잘린 목록을 "전부"로 읽으면 참여가 조용히 빠진다):
--   · 정렬은 항상 session_date, start_time(HH:MI), id — 같은 조건이면 같은 순서다.
--   · after(커서) = 그 키 **바로 다음**부터. page = (page-1)×page_size 건을 건너뛴다. 둘 다 오면 after가 이긴다.
--     after의 모양이 틀리면 조건을 무시하지 않고 거절한다(첫 쪽을 다시 주면 같은 줄을 두 번 읽게 된다).
--   · truncated = 이 쪽 뒤에 줄이 더 있다. next_after = 이 쪽 마지막 줄의 키(더 없으면 null). total = 조건에 맞는 전체 줄 수.
--   범위(0344c participant_in_scope): 지점 전체 읽기 권한이 아니면 내가 맡은 회차 · 지금 담당 반(출결 반/합류 반) ·
--     지금 담당하는 같은 과목 반의 재원 학생.
--   legacy_maps는 이 쪽의 참여와 요청한 예약 id의 **살아 있는 연결**만 돌려준다 — 연결된 예약인지 알아야 기존 훅이 물러선다.
--   🔴 요청한 예약 id에도 같은 범위가 걸린다(범위 밖 연결은 있는지조차 알려 주지 않는다). case_ids·original_date도 범위 안 건만.
-- 🔴 꺼짐(off)이면 예외 — 실패를 빈 목록·0건으로 위장하지 않는다.
-- 멱등: create or replace.

create or replace function public.makeup_list_participants(p_filter jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  a makeup_private.actor_ctx := makeup_private.actor();
  f jsonb := coalesce(p_filter, '{}'::jsonb);
  v_students uuid[] := case when jsonb_typeof(f -> 'student_ids') = 'array'
    then array(select x::uuid from jsonb_array_elements_text(f -> 'student_ids') x) end;
  v_legacy uuid[] := case when jsonb_typeof(f -> 'legacy_reservation_ids') = 'array'
    then array(select x::uuid from jsonb_array_elements_text(f -> 'legacy_reservation_ids') x) end;
  v_student uuid := makeup_private.p_uuid(f, 'student_id');
  v_subject text := makeup_private.p_text(f, 'subject_key');
  v_date date := makeup_private.p_date(f, 'session_date');
  v_from date := makeup_private.p_date(f, 'date_from');
  v_to date := makeup_private.p_date(f, 'date_to');
  v_class uuid := makeup_private.p_uuid(f, 'class_id');
  v_teacher uuid := makeup_private.p_uuid(f, 'teacher_id');
  v_cancelled boolean := coalesce((f -> 'include_cancelled') = 'true'::jsonb, false);
  v_limit integer := least(greatest(coalesce(makeup_private.p_int(f, 'limit'), makeup_private.p_int(f, 'page_size'), 200), 1), 500);
  v_page integer := greatest(coalesce(makeup_private.p_int(f, 'page'), 1), 1);
  v_after jsonb := case when jsonb_typeof(f -> 'after') = 'object' then f -> 'after' end;
  v_a_date date; v_a_time text; v_a_id uuid;
  v_rows jsonb;
  v_n integer;
  v_total integer;
  v_all boolean;
begin
  perform makeup_private.require_mode(a, 'read');
  v_all := makeup_private.can_read_all(a);
  if f ? 'after' and jsonb_typeof(f -> 'after') <> 'null' then
    v_a_date := makeup_private.p_date(v_after, 'session_date');
    v_a_time := substr(makeup_private.p_text(v_after, 'start_time'), 1, 5);
    if v_a_date is null or v_a_time is null or v_a_time !~ '^\d{2}:\d{2}$' or coalesce(v_after ->> 'id', '') !~ '^[0-9a-fA-F-]{36}$' then
      perform makeup_private.fail('invalid', '목록을 이어 읽을 위치가 올바르지 않습니다 — 처음부터 다시 읽어 주세요');
    end if;
    v_a_id := (v_after ->> 'id')::uuid;
    v_page := 1;
  end if;
  with hit as (
    select p.id, p.revision, p.session_id, s.revision as session_revision, p.student_id, p.subject_key, p.session_date,
      to_char(s.start_time, 'HH24:MI') as start_time, to_char(s.end_time, 'HH24:MI') as end_time, s.period_ids,
      coalesce(p.anchor_class_id, s.class_id) as class_id, p.anchor_class_id, s.class_id as host_class_id,
      s.teacher_id, s.classroom_id, s.state as session_state, p.status, p.planned_minutes, p.actual_minutes,
      (select fu.report_id from public.makeup_fulfillments fu where fu.participant_id = p.id and fu.state <> 'reversed') as report_id,
      p.attendance_record_id,
      (select m.legacy_id from public.makeup_legacy_maps m
        where m.participant_id = p.id and m.state = 'active' limit 1) as legacy_reservation_id,
      -- 이 참여에 걸린 건 가운데 행위자 범위 안의 것만(같은 학생의 다른 건 번호·원수업일이 새지 않게).
      array(select al.case_id from public.makeup_allocations al
             where al.participant_id = p.id and (v_all or makeup_private.in_scope(a, al.case_id)) order by al.case_id) as case_ids,
      (select min(c.original_date) from public.makeup_allocations al join public.makeup_cases c on c.id = al.case_id
        where al.participant_id = p.id and (v_all or makeup_private.in_scope(a, al.case_id))) as original_date
    from public.makeup_participants p
    join public.makeup_sessions s on s.id = p.session_id
    where p.tenant_id = a.tenant_id
      and (v_cancelled or p.status <> 'cancelled')
      and (v_student is null or p.student_id = v_student)
      and (v_students is null or p.student_id = any (v_students))
      and (v_subject is null or p.subject_key = v_subject)
      and (v_date is null or p.session_date = v_date)
      and (v_from is null or p.session_date >= v_from) and (v_to is null or p.session_date <= v_to)
      and (v_class is null or v_class in (p.anchor_class_id, s.class_id))
      and (v_teacher is null or s.teacher_id = v_teacher)
      and (v_legacy is null or exists (select 1 from public.makeup_legacy_maps m
                                        where m.participant_id = p.id and m.legacy_id = any (v_legacy)))
      and makeup_private.participant_in_scope(a, p.id)
  ), page as (
    select h.* from hit h
     where v_a_id is null or (h.session_date, h.start_time, h.id) > (v_a_date, v_a_time, v_a_id)
     order by h.session_date, h.start_time, h.id
     offset (v_page - 1) * v_limit limit v_limit + 1
  )
  select coalesce(jsonb_agg(to_jsonb(g) order by g.session_date, g.start_time, g.id), '[]'::jsonb), count(*),
         (select count(*) from hit)
    into v_rows, v_n, v_total from page g;
  if v_n > v_limit then v_rows := v_rows - v_limit; end if;
  return jsonb_build_object('mode', a.mode, 'truncated', v_n > v_limit, 'total', v_total, 'page', v_page, 'page_size', v_limit,
    'next_after', case when v_n > v_limit then jsonb_build_object(
      'session_date', v_rows -> (v_limit - 1) -> 'session_date', 'start_time', v_rows -> (v_limit - 1) -> 'start_time',
      'id', v_rows -> (v_limit - 1) -> 'id') end,
    'participants', v_rows,
    'legacy_maps', coalesce((
      -- 🔴 요청한 예약 id라고 범위를 건너뛰지 않는다 — 연결의 참여(또는 건)가 행위자 범위 안일 때만 돌려준다.
      select jsonb_agg(jsonb_build_object('id', m.id, 'legacy_reservation_id', m.legacy_id,
        'participant_id', case when v_all or makeup_private.participant_in_scope(a, m.participant_id) then m.participant_id end,
        'case_id', case when v_all or makeup_private.in_scope(a, m.case_id) then m.case_id end,
        'effect_key', m.native_effect_key, 'state', m.state) order by m.created_at)
        from public.makeup_legacy_maps m
       where m.tenant_id = a.tenant_id and m.legacy_kind = 'reservation' and (m.state = 'active' or v_cancelled)
         and (m.legacy_id = any (coalesce(v_legacy, '{}'::uuid[]))
              or m.participant_id in (select (x ->> 'id')::uuid from jsonb_array_elements(v_rows) x))
         and (v_all or (m.participant_id is not null and makeup_private.participant_in_scope(a, m.participant_id))
              or makeup_private.in_scope(a, m.case_id))), '[]'::jsonb));
end;
$$;

revoke all on function public.makeup_list_participants(jsonb) from public, anon, service_role;
grant execute on function public.makeup_list_participants(jsonb) to authenticated;
notify pgrst, 'reload schema';
