-- 0349a — 기존 표의 우회 차단: 연결된 예약(0264a)과 연결된 수업 보고서
--
-- 원장에 연결된 기존 기록을 옛 직접 쓰기 경로로 고치거나 지우면 원장과 어긋난다. 그 우회만 DB에서 막는다.
--   ① makeup_reservations
--      · 연결된(makeup_legacy_maps.state = 'active') 예약의 직접 UPDATE/DELETE 거절 — 보강관리 명령 안에서만 바뀐다.
--        기존 완료 훅·취소 버튼은 연결된 건이면 명령(participation·cancel)으로 위임해야 한다.
--      · 원장에 그날 같은 과목(또는 시간이 겹치는) 참여가 있는 학생에게 예약을 직접 INSERT 거절 — 하루 한 건
--        상한을 옛 예약 경로로 돌아 넘지 못한다. 예약 확정(book)과 같은 학생-날짜 잠금으로 줄을 선다.
--      · 연결되지 않은 예약은 종전 그대로다(이 트리거는 조회 한 번 뒤 통과).
--   ② lesson_reports — 실시 기록에 연결된 보고서의 직접 DELETE, 학생·날짜·과목·반 변경 거절.
--      본문·발송 상태 등 나머지 수정은 종전 그대로다(회수·수정 규칙을 건드리지 않는다).
-- 🔴 이 보호는 운영 모드와 무관하다 — 보강관리를 끈 뒤에도 연결된 건의 직접 삭제로 되돌아가지 않는다.
-- 🔴 출결(attendance_records) 저장은 여기서 막지 않는다. 출결 쪽은 0349b가 **관측만** 한다.
-- 학원(tenant)이 지워질 때의 연쇄 삭제는 통과한다.
-- 멱등: create or replace + drop trigger if exists.

create or replace function makeup_private.tg_guard_legacy_reservation() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_subject text;
begin
  if makeup_private.in_command() then return coalesce(new, old); end if;
  if tg_op = 'INSERT' then
    -- 원장이 그 학생·그날에 아무것도 없으면(대부분) 잠금 없이 통과한다.
    if not exists (select 1 from public.makeup_participants p
                    where p.tenant_id = new.tenant_id and p.student_id = new.student_id
                      and p.session_date = new.makeup_date and p.status <> 'cancelled')
       and not exists (select 1 from public.makeup_cases c
                        where c.tenant_id = new.tenant_id and c.student_id = new.student_id and c.lifecycle <> 'closed') then
      return new;
    end if;
    perform makeup_private.lock_keys(new.tenant_id, array['stu:' || new.student_id::text || ':' || new.makeup_date::text]);
    select c.subject into v_subject from public.classes c where c.id = new.class_id;
    if exists (
      select 1 from public.makeup_participants p join public.makeup_sessions s on s.id = p.session_id
       where p.tenant_id = new.tenant_id and p.student_id = new.student_id and p.session_date = new.makeup_date
         and p.status <> 'cancelled'
         and (p.subject_key = v_subject or (s.start_time < new.slot_end and s.end_time > new.slot_start))) then
      raise exception '보강관리에 그날 보강이 이미 잡혀 있습니다 — 보강관리에서 일정을 확인해 주세요';
    end if;
    return new;
  end if;
  if exists (select 1 from public.makeup_legacy_maps m
              where m.legacy_kind = 'reservation' and m.legacy_id = old.id and m.state = 'active') then
    if tg_op = 'DELETE' and not exists (select 1 from public.tenants t where t.id = old.tenant_id) then
      return old;
    end if;
    -- 출결 행·직원 행이 지워져 연결 칸만 비는 변경(FK set null)은 통과 — 출결 삭제·직원 삭제를 이 보호가 막으면 안 된다.
    -- (원장 표와 같은 조건: 참조 무결성 동작이 일으킨 변경이고 그 바깥 행이 실제로 없어졌을 때만 — 직접 UPDATE는 통과하지 못한다.)
    if tg_op = 'UPDATE' and pg_trigger_depth() > 1
       and (old.attendance_record_id is not distinct from new.attendance_record_id
            or not exists (select 1 from public.attendance_records x where x.id = old.attendance_record_id))
       and (old.created_by is not distinct from new.created_by
            or not exists (select 1 from public.users x where x.id = old.created_by))
       and (new.attendance_record_id is null or new.attendance_record_id is not distinct from old.attendance_record_id)
       and (new.created_by is null or new.created_by is not distinct from old.created_by)
       and (to_jsonb(new) - array['attendance_record_id', 'created_by', 'updated_at'])
           = (to_jsonb(old) - array['attendance_record_id', 'created_by', 'updated_at']) then
      return new;
    end if;
    raise exception '보강관리에 연결된 예약입니다 — 보강관리에서 변경하거나 취소해 주세요';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists makeup_reservations_native_guard on public.makeup_reservations;
create trigger makeup_reservations_native_guard
  before insert or update or delete on public.makeup_reservations
  for each row execute function makeup_private.tg_guard_legacy_reservation();

create or replace function makeup_private.tg_guard_linked_report() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if makeup_private.in_command()
     or not exists (select 1 from public.makeup_fulfillments f where f.report_id = old.id and f.state <> 'reversed') then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.tenants t where t.id = old.tenant_id) then return old; end if;
    raise exception '보강 실시 기록에 연결된 보고서입니다 — 보강관리에서 기록을 정정한 뒤 지워 주세요';
  end if;
  if new.student_id is distinct from old.student_id or new.report_date is distinct from old.report_date
     or new.subject is distinct from old.subject or new.class_id is distinct from old.class_id then
    raise exception '보강 실시 기록에 연결된 보고서는 학생·날짜·과목·반을 바꿀 수 없습니다';
  end if;
  return new;
end;
$$;

drop trigger if exists lesson_reports_makeup_link_guard on public.lesson_reports;
create trigger lesson_reports_makeup_link_guard
  before delete or update of student_id, report_date, subject, class_id on public.lesson_reports
  for each row execute function makeup_private.tg_guard_linked_report();

revoke all on all functions in schema makeup_private from public, anon, authenticated;
