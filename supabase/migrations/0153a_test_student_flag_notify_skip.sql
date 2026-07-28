-- 0153a: 테스트 학생 플래그(`students.is_test`) + 발송 실패 알림에서 테스트 학생 제외
--
-- 배경(원장 제보 2026-07-28): ClassNote 발송 테스트용 학생 **학원이**의 보고서가 실패하자
-- 0143a 트리거가 담당 강사(이수진)에게 "수업 보고서 발송 실패 — 학원이 · 07-22 …" 벨 알림을 보냈다.
-- 테스트 계정은 학부모가 없으니 실패가 정상인데, 강사는 매번 진짜 실패로 오인해 확인하러 간다
-- (알림 신뢰도가 떨어지면 진짜 실패도 무시된다 — 알림의 가치는 "울리면 진짜"에 있다).
--
-- 설계: 이름 패턴("학원%"·"%테스트%")을 트리거 안에 하드코딩하지 않는다 — 실학생이 그 패턴에 걸리면
-- 진짜 실패가 조용히 사라진다(가장 나쁜 실패 모드). 대신 **명시 플래그**를 두고 사람이 지정한다.
-- 플래그는 앞으로 통계·작성률·발송 큐에서도 재사용할 수 있는 단일 진실이 된다.

-- 1) 플래그 ------------------------------------------------------------------
-- 상수 default라 테이블 재작성 없음(0087a와 같은 이유). not null이라 조회부에 null 분기 불필요.
alter table public.students
  add column if not exists is_test boolean not null default false;

comment on column public.students.is_test is
  '테스트용 학생(발송 검증 등). 실패 알림·집계에서 제외한다 — 이름 패턴 대신 명시 지정(0153a)';

-- 2) 백필 — 2026-07-28 기준 실제 테스트 계정만. 이름 패턴은 **여기서 1회만** 쓰고 트리거엔 넣지 않는다.
update public.students
set is_test = true
where is_test = false
  and name in ('학원이', '학원이A', '학원일', '학원삼', '학원사', '학원오', '학원육',
               '테스트', '선생님테스트', '원일(테스트)', '박소선 (테스트)', '장준호(테스트)');

-- 3) 발송 실패 알림에서 테스트 학생 제외 ---------------------------------------
-- 0143a 본문 그대로 + 맨 앞 가드 한 줄. (본문을 바꾸지 않았다 — 문구·수신자 규칙은 0143a가 정본.)
create or replace function public.notify_report_send_failed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipient uuid;
  v_student text;
  v_hint text;
begin
  -- 🔴 테스트 학생(0153a)은 알리지 않는다 — 학부모가 없어 실패가 정상이라 매번 오탐이 된다.
  if exists (select 1 from public.students s where s.id = NEW.student_id and s.is_test) then
    return NEW;
  end if;

  -- 수신자 ① 반 담당 강사
  select c.teacher_id into v_recipient
  from public.classes c
  where c.id = NEW.class_id and c.teacher_id is not null;

  -- 수신자 ② 보고서에 적힌 강사 이름과 일치하는 재직 강사(반 연결이 끊긴 옛 행 대비)
  if v_recipient is null and coalesce(NEW.teacher_name, '') <> '' then
    select u.id into v_recipient
    from public.users u
    where u.tenant_id = NEW.tenant_id
      and u.status = 'active'
      and u.display_name = NEW.teacher_name
    limit 1;
  end if;

  select s.name into v_student from public.students s where s.id = NEW.student_id;

  v_hint := case
    when coalesce(NEW.classnote_error, '') ilike '%학생 없음%'
      then '학부모가 ClassNote 알림장에 연결되어 있지 않습니다 — 학부모를 초대한 뒤 다시 발송하세요.'
    when coalesce(NEW.classnote_error, '') = '' then '사유가 기록되지 않았습니다 — 발송 콘솔에서 확인하세요.'
    else NEW.classnote_error
  end;

  if v_recipient is null then
    insert into public.notifications (tenant_id, recipient_id, type, title, body, link, actor_id)
    select NEW.tenant_id, u.id, 'report_send_failed', '수업 보고서 발송 실패',
           coalesce(v_student, '학생') || ' · ' || to_char(NEW.report_date, 'MM-DD') || ' — ' || v_hint,
           '/lesson-reports', null
    from public.users u
    where u.tenant_id = NEW.tenant_id and u.status = 'active' and u.system_role = 'master';
  else
    insert into public.notifications (tenant_id, recipient_id, type, title, body, link, actor_id)
    values (NEW.tenant_id, v_recipient, 'report_send_failed', '수업 보고서 발송 실패',
            coalesce(v_student, '학생') || ' · ' || to_char(NEW.report_date, 'MM-DD') || ' — ' || v_hint,
            '/lesson-reports', null);
  end if;

  return NEW;
exception
  -- best-effort — 알림 insert가 실패해도 발송 상태 기록(본 UPDATE)을 막지 않는다(0143a 원칙 유지).
  when others then
    return NEW;
end;
$$;

comment on function public.notify_report_send_failed() is
  '수업 보고서 ClassNote 발송 최종 실패 시 담당 강사(없으면 master)에게 알림 — 테스트 학생 제외(0143a + 0153a)';
