-- 0350a — 보강 상세 읽기의 파생 값: 다시 인정할 수 있는 분량 · 출결 연결 상태 · 참여별로 할 수 있는 일
--
-- 셋 다 **읽기 전용 힌트**다. 저장을 허용하는 쪽은 명령(0346*)이고, 명령은 이 값을 믿지 않고 다시 판정한다(#77).
--   recognizable_minutes — 검토(0346f cmd_verify)가 이 배정에 받아 주는 최대 인정 분. 검토의 식을 그대로 옮겼다:
--       살아 있는 배정 + min(해제된 분, 건의 예약 가능량). 실제 지도 분과 600분을 넘지 않는다.
--     인정을 되돌린 뒤에는 배정이 전부 해제량으로 가 있어 "배정 − 해제"가 0이지만, 검토는 풀려 있던 같은 배정을 건의 예약
--     가능량 안에서 되잡는다. 그 사이 다른 일정이 분량을 잡았으면 이 값도 그만큼 줄어든다(되잡을 수 없는 분은 내주지 않는다).
--     🔴 검토의 식을 바꾸면 이 함수도 같이 바꾼다 — 27_recognizable.sql이 "이 값까지는 통과 · 1분 더는 거절"로 둘을 묶는다.
--   attendance_link — 그 참여의 출결 연결: failed(반영 실패) · pending(확인 대기) · linked(출결 행 연결됨) · none(연결된 출결 없음).
--     지도 근거 글만으로 인정한 참여는 none일 수 있다. 표시일 뿐이고 인정·종결 조건을 바꾸지 않는다(0346f try_close 그대로).
--   participant_actions — 참여 한 건에 이 계정이 지금 할 수 있는 일과, 못 하면 그 까닭(코드 한 개). 명령의 검사를 그대로 따른다:
--       record(0346e 참여 기록) · submit(0346f 검토 제출) · cancel · reschedule(0346d)
--     까닭 코드: read_only · draining · not_conductor · out_of_scope · participant_cancelled · session_closed · future_session ·
--       verified · already_recorded · no_open_record. 화면은 코드를 그대로 찍지 않고 한글 안내로 바꾼다.
--     예약 변경은 새 날짜의 자리·시간·기한을 명령이 다시 보므로 true여도 거절될 수 있다(여기는 "이 참여를 옮길 자격"까지만).
-- 🔴 이 파일은 표를 쓰지 않는다.
-- 멱등: create or replace.

create or replace function makeup_private.recognizable_minutes(p_alloc uuid) returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select greatest(least(
           (al.allocated_minutes - al.recognized_minutes - al.released_minutes)
             + least(al.released_minutes, greatest(c.outstanding_minutes - c.committed_minutes, 0)),
           coalesce(p.actual_minutes, 0), 600), 0)
    from public.makeup_allocations al
    join public.makeup_cases c on c.id = al.case_id
    join public.makeup_participants p on p.id = al.participant_id
   where al.id = p_alloc
$$;

create or replace function makeup_private.attendance_link(p_tenant uuid, p_part uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select case
           when exists (select 1 from public.makeup_projection_jobs j
                         where j.tenant_id = p_tenant and j.state = 'failed'
                           and j.kind = 'attendance_effect' and j.effect_key = 'att:' || p.id::text
                           and (j.participant_id = p.id or p.id = any (j.participant_ids))) then 'failed'
           when exists (select 1 from public.makeup_projection_jobs j
                         where j.tenant_id = p_tenant and j.state = 'pending'
                           and j.kind = 'attendance_effect' and j.effect_key = 'att:' || p.id::text
                           and (j.participant_id = p.id or p.id = any (j.participant_ids))) then 'pending'
           when p.attendance_record_id is not null then 'linked'
           else 'none' end
    from public.makeup_participants p
   where p.id = p_part and p.tenant_id = p_tenant
$$;

create or replace function makeup_private.participant_actions(a makeup_private.actor_ctx, p_part uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_p public.makeup_participants%rowtype;
  v_s public.makeup_sessions%rowtype;
  v_mine boolean;      -- 지점 전체 운영이거나 이 회차를 맡은 강사
  v_scope boolean;     -- 이 참여에 걸린 건이 전부 담당 범위 안
  v_verified boolean;  -- 검토를 마친 실시 기록이 있다
  v_open boolean;      -- 제출할 수 있는 실시 기록(초안·보완 요청)이 있다
  v_record text;
  v_submit text;
  v_cancel text;
  v_move text;
begin
  select * into v_p from public.makeup_participants x where x.id = p_part and x.tenant_id = a.tenant_id;
  if not found then return '{}'::jsonb; end if;
  select * into v_s from public.makeup_sessions s where s.id = v_p.session_id;
  v_mine := a.wide or coalesce(v_s.teacher_id = a.user_id, false);
  v_scope := not exists (select 1 from public.makeup_allocations al
                          where al.participant_id = p_part and not makeup_private.in_scope(a, al.case_id));
  v_verified := exists (select 1 from public.makeup_fulfillments f where f.participant_id = p_part and f.state = 'verified');
  v_open := exists (select 1 from public.makeup_fulfillments f
                     where f.participant_id = p_part and f.state in ('draft', 'returned'));

  v_record := case
    when a.access = 'readonly' then 'read_only'
    when v_p.status = 'cancelled' then 'participant_cancelled'
    when v_s.state not in ('confirmed', 'finished') then 'session_closed'
    when v_verified then 'verified'
    when v_s.session_date > a.today then 'future_session'
    when not v_mine then 'not_conductor' end;
  v_submit := case
    when a.access = 'readonly' then 'read_only'
    when v_p.status = 'cancelled' then 'participant_cancelled'
    when v_verified then 'verified'
    when v_p.status not in ('present', 'partial') or not v_open then 'no_open_record'
    when not v_mine then 'not_conductor' end;
  v_cancel := case
    when a.access = 'readonly' then 'read_only'
    when v_p.status = 'cancelled' then 'participant_cancelled'
    when v_s.state <> 'confirmed' then 'session_closed'
    when v_p.status <> 'unknown' then 'already_recorded'
    when not v_mine and not v_scope then 'out_of_scope' end;
  v_move := case
    when a.access = 'readonly' then 'read_only'
    when a.mode <> 'on' then 'draining'
    when v_p.status = 'cancelled' then 'participant_cancelled'
    when v_s.state <> 'confirmed' then 'session_closed'
    when v_p.status <> 'unknown' then 'already_recorded'
    when not v_mine then 'not_conductor' end;
  return jsonb_build_object(
    'actions', jsonb_build_object('record', v_record is null, 'submit', v_submit is null,
      'cancel', v_cancel is null, 'reschedule', v_move is null),
    'blocked', jsonb_build_object('record', v_record, 'submit', v_submit, 'cancel', v_cancel, 'reschedule', v_move));
end;
$$;

revoke all on all functions in schema makeup_private from public, anon, authenticated;
