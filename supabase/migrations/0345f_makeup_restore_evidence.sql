-- 0345f — 케이스 잠금 공유 · 증거 조회 · 노쇼 되돌리기의 재검사
--
-- lock_touched_cases — 관측 트리거·대사 실행·반영 실패 기록처럼 **명령 밖**에서 대사·작업을 쓰는 길이, 쓰기 전에 닿는 케이스
--   행을 id순으로 잠근다. 종결(자동·수동)은 같은 행 잠금을 쥔 채 미결 항목을 세므로 둘은 반드시 순서가 선다:
--     관측이 먼저 → 종결이 그 항목을 보고 막힌다 / 종결이 먼저 → 관측은 닫힌 건에 항목을 남긴다(목록·상세에 보인다).
--   없는 케이스가 섞여도 실패하지 않는다(관측은 정규 저장을 막지 않는다). 순서: 문(gate) → … → 케이스(0345a).
-- evidence_json — 참여의 지금 증거(읽기 전용). 명령 결과·재시도 확인이 같은 모양을 쓴다.
-- restore_no_show — 노쇼는 자리와 배정을 푼 것이다. 되돌릴 때:
--   · 🔴 그 배정이 걸린 건이 **이미 종결됐으면 거절**한다. 닫힌 건에 약속을 되살리지 않는다 — 건을 새로 접수하거나 다른 열린 건으로
--     새 일정을 잡아야 한다(다시 여는 명령은 없다).
--   · 회차 정원·강의실 정원·학생 시간 겹침·남은 분량을 **다시** 본다(그 사이 찬 자리·잡힌 분량을 되살리지 않는다).
--   호출 전에 문(gate)·학생 잠금과 케이스 잠금을 잡는다(0346e).
-- 멱등: create or replace.

create or replace function makeup_private.lock_touched_cases(p_tenant uuid, p_ids uuid[]) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform 1 from (select c.id from public.makeup_cases c
                   where c.tenant_id = p_tenant and c.id = any (p_ids) order by c.id for update) q;
end;
$$;

create or replace function makeup_private.evidence_json(p_tenant uuid, p_part uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'attendance_record_id', ar.id, 'session_units', to_jsonb(ar) -> 'session_units', 'taught_by', to_jsonb(ar) -> 'taught_by',
    'report_id', f.report_id, 'actual_teacher_id', coalesce(f.actual_teacher_id, s.teacher_id))
  from public.makeup_participants p
  join public.makeup_sessions s on s.id = p.session_id
  left join public.attendance_records ar on ar.id = p.attendance_record_id and ar.tenant_id = p_tenant
  left join public.makeup_fulfillments f on f.participant_id = p.id and f.state <> 'reversed'
  where p.id = p_part and p.tenant_id = p_tenant
$$;

create or replace function makeup_private.restore_no_show(a makeup_private.actor_ctx, p_part uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_p public.makeup_participants%rowtype;
  v_s public.makeup_sessions%rowtype;
  v_cap integer; v_room_cap integer;
  v_case uuid;
begin
  select * into v_p from public.makeup_participants x where x.id = p_part;
  select * into v_s from public.makeup_sessions s where s.id = v_p.session_id;
  if exists (select 1 from public.makeup_allocations al join public.makeup_cases c on c.id = al.case_id
              where al.participant_id = p_part and c.lifecycle = 'closed') then
    perform makeup_private.fail('conflict', '이미 종결한 보강 건의 일정이라 되돌릴 수 없습니다 — 새 보강 건으로 다시 잡아 주세요',
      jsonb_build_object('reason', 'case_closed'));
  end if;
  select * into v_cap, v_room_cap from makeup_private.resolve_capacity(a.tenant_id, v_s.teacher_id, v_s.classroom_id, v_s.capacity);
  -- 노쇼인 지금은 자리를 차지하지 않는다 → 한 명을 더하는 것으로 다시 센다.
  perform makeup_private.check_session_resources(a.tenant_id, v_s.id, v_s.session_date, v_s.start_time, v_s.end_time,
    v_s.teacher_id, v_s.classroom_id, v_cap, v_room_cap, 1);
  if exists (
       select 1 from public.makeup_participants o join public.makeup_sessions os on os.id = o.session_id
        where o.tenant_id = a.tenant_id and o.student_id = v_p.student_id and o.session_date = v_p.session_date and o.id <> p_part
          and o.status in ('unknown', 'present', 'partial') and os.state in ('confirmed', 'finished')
          and os.start_time < v_s.end_time and os.end_time > v_s.start_time)
     or exists (
       select 1 from makeup_private.regular_slots(a.tenant_id, v_s.session_date) r
        where r.start_time < v_s.end_time and r.end_time > v_s.start_time
          and makeup_private.attends_on(a.tenant_id, v_p.student_id, r.class_id, v_s.session_date)) then
    perform makeup_private.fail('conflict', '그 시간에 학생의 다른 일정이 있어 되돌릴 수 없습니다 — 새 일정으로 다시 잡아 주세요');
  end if;
  update public.makeup_allocations al set released_minutes = 0, release_reason = null
   where al.participant_id = p_part and al.release_reason = 'no_show';
  for v_case in select al.case_id from public.makeup_allocations al where al.participant_id = p_part order by al.case_id loop
    perform makeup_private.recompute_case(v_case);
  end loop;
end;
$$;

revoke all on all functions in schema makeup_private from public, anon, authenticated;
