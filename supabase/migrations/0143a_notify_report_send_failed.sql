-- 0143a: 수업 보고서 ClassNote **발송 실패 → 담당 강사에게 알림**
--
-- 배경(원장 제보 2026-07-23): 손민우 학생 07-22 보고서가 `해당 학생 없음`(= 학부모가 ClassNote 알림장에
-- 연결되지 않음)으로 3회 재시도 끝에 failed. 그런데 **원장에게 로그로만** 남아, 정작 학부모를 초대해야 할
-- 담당 강사(이성우)는 이 사실을 알 길이 없다 → 원장 지시: "담당에게도 알림. 안 그러면 영원히 모를듯".
--
-- 왜 트리거인가: 상태 전이를 만드는 주체가 **연동 PC 워커**(앱 밖, 직접 SQL)라 앱 액션 훅으로는 못 잡는다.
-- cron 배치로 하면 최대 하루 늦고, 워커를 고치면 zip 물리 이관이 필요하다. 트리거는 **전이 즉시·앱 배포만으로**
-- 동작하고, 앱에서 재발송해 실패한 경우도 같은 경로로 잡힌다.
--
-- 노이즈 설계(원장 "알림이 너무 자주 가지 않게 발송했을 때 발송 실패하는 경우에"):
--   · 발화 조건 = `classnote_status`가 **'failed'로 바뀌는 순간만**. 워커는 재시도 3회를 채워야 'failed'로
--     쓰므로(그 전에는 'queued'), 한 번의 발송 시도당 최대 1건이다. 재시도·대기 중에는 알리지 않는다.
--   · 같은 값으로의 재저장(failed → failed)은 `is distinct from`으로 걸러 발화하지 않는다.
--   · 실측(2026-07-23 전수): 전체 12,483건 중 failed는 **1건** — 평상시 이 알림은 거의 울리지 않는다.
--
-- 수신자: 반 담당 강사(classes.teacher_id) → 없으면 teacher_name과 이름이 같은 재직 강사 →
--         그래도 없으면 master(누구도 못 받는 알림이 되지 않게). 시스템 이벤트라 actor_id는 null.

-- 1) 트리거 함수 -------------------------------------------------------------
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

  -- 원인별 **행동 지시** — 벨에서 바로 무엇을 해야 하는지 보이게.
  -- ⚠️ 이 문구는 발송 콘솔의 `humanizeClassnoteError`(src/features/report-admin/classnote-error.ts)와
  --    같은 뜻으로 유지할 것. 두 표면이 같은 실패를 다르게 설명하면 원장·강사가 서로 다른 조치를 한다.
  v_hint := case
    when coalesce(NEW.classnote_error, '') ilike '%학생 없음%'
      then '학부모가 ClassNote 알림장에 연결되어 있지 않습니다 — 학부모를 초대한 뒤 다시 발송하세요.'
    when coalesce(NEW.classnote_error, '') = '' then '사유가 기록되지 않았습니다 — 발송 콘솔에서 확인하세요.'
    else NEW.classnote_error
  end;

  -- 수신자 ③ 폴백 = master 전원(담당을 못 찾아도 알림이 사라지지 않게)
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
  -- ⚠️ **best-effort** — 알림 insert가 실패해도 발송 상태 기록(본 UPDATE)을 절대 막지 않는다.
  -- 앱의 notifyUsers와 같은 원칙: 알림 때문에 본 작업이 깨지면 워커가 그 보고서에서 계속 넘어지고,
  -- 상태가 영영 'queued'에 갇혀 **실패 사실 자체가 사라진다**(고치려던 문제가 더 커진다).
  when others then
    return NEW;
end;
$$;

-- 2) 트리거 — 'failed'로 **바뀌는** 전이에서만(같은 값 재저장·재시도 중(queued)은 발화하지 않음).
drop trigger if exists trg_notify_report_send_failed on public.lesson_reports;
create trigger trg_notify_report_send_failed
after update of classnote_status on public.lesson_reports
for each row
when (NEW.classnote_status = 'failed' and OLD.classnote_status is distinct from 'failed')
execute function public.notify_report_send_failed();

comment on function public.notify_report_send_failed() is
  '수업 보고서 ClassNote 발송이 최종 실패(failed)하면 담당 강사(없으면 master)에게 벨 알림 — 0143a';
