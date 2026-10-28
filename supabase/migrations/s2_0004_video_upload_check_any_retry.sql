-- s2_0004 — '영상 업로드 확인' 할 일: ① 숙제 없이 올리다 멈춘 파일을 그 학생이 숙제를 골라 다시 올려 들어와도 처리됨
--                                  ② 할 일 문구에 몇 월 며칠(요일) 숙제인지 · 숙제를 안 골랐으면 그렇다고 + 올린 시각
--
-- 원장 2026-10-28 *"이거 체크했는데도 내 할 일이 안사라진다고 하는데 체크해봐"* · *"몇일자 숙제인지 더 명확하게 설명해줄것"* —
--   이준형 · 초등M 개별 BS2G 10/26 19:28. 학생이 숙제를 고르지 않고 올리다 멈춤(회차 = 반|u:업로드번호) → 1분 뒤 같은 영상(크기
--   거의 같음)을 10-22 숙제로 다시 올려 끝까지 들어옴. 0379a는 숙제 없는 시도를 **그 뒤의 숙제 없는 업로드**로만 닫아서, 숙제를 골라
--   다시 올린 영상을 세지 않았다. 문구도 숙제 날짜가 없으면 아무 날짜 없이 "올리다 멈춘 기록이 있습니다"뿐이었다.
-- ① `video_upload_settle`의 숙제 없는 갈래: 그 뒤 같은 학생·반의 숙제 없는 업로드(0379a 그대로) **또는 멈춘 시도와 같은 파일**(크기 ±1%)을
--    숙제를 골라 다시 올린 업로드가 영상을 남기면 처리. 숙제를 고른 업로드를 모두 세지 않는 것은, '숙제 없이 올리기'가 숙제를 낸 뒤
--    추가 영상(메모 필수)을 올리는 통로이기도 해서(docs/decisions/reports-ai.md) 다음 숙제를 올리는 순간 끝내 안 들어온 추가 영상의
--    할 일까지 닫히기 때문이다(리뷰 2026-10-28). 운영 재시도 2건은 크기 차 0% · 0.0004%, 다른 숙제 영상은 1,600% 넘게 달랐다.
--    숙제를 고른 시도(반|숙제일)의 판정은 그대로다 — 그 숙제 영상이 들어와야(같은 숙제일 업로드 · 숙제 칸 '완료') 처리된다.
-- ② 문구 = `video_upload_detail` 한 곳 — "학생 · 반 — 10월 19일(월) 숙제 영상을 올리다 멈췄습니다" /
--    "학생 · 반 — 어느 숙제인지 고르지 않고 올린 영상(10월 26일 19:28)이 멈췄습니다". 이미 있는 이 종류 할 일(열린·끝난 모두)의
--    문구도 같은 함수로 다시 쓴다(detail 칸만 — 상태·시각은 그대로 · staff_tasks 트리거는 상태 바뀔 때만 돈다).
-- ③ 진단 알림보다 영상이 먼저 들어와 할 일이 열자마자 닫히면, 닫힘 트리거(알림 읽음)가 알림을 잇기 전에 돌아 실패 알림이 읽지 않은 채
--    처리된 할 일에 붙어 남았다(운영 10/26 한 건에 9개 · 리뷰). `tg_video_upload_task`가 이을 때 할 일이 이미 닫혔으면 읽음도 찍고,
--    남은 것을 한 번 읽음으로(닫힘 트리거와 같은 규칙).
-- 본문 = 운영 함수(= 0379a 정의, 공백 정규화 md5 일치 확인 2026-10-28)에서 위 줄만 바꿨다.
-- 끝에 지금 열린 숙제 없는 할 일을 한 번 맞춘다(운영 드라이런 2026-10-28: 열린 1건이 닫힘 · 이미 처리된 1건은 그대로). 다시 돌려도 같다.
-- 앱과 순서 무관(앱은 이 함수들을 부르지 않는다 — 트리거·30분 맞춤 `staff_tasks_sync`가 부른다 · 앱은 detail을 그대로 보여 준다).
-- 되돌리기: scripts/_oneoff/revert-s2_0004-video-upload-check-any-retry.sql(0379a 본문 — 닫힌 할 일은 다시 안 열림 · 새 문구는 그대로 ·
--   앱 `kinds.ts` doneRule 문구는 앱 되돌리기로 따로).
begin;

-- ② 할 일 문구 — 숙제일이 있으면 "M월 D일(요일) 숙제 영상", 없으면 "어느 숙제인지 고르지 않고 올린 영상(M월 D일 HH:MI)".
create or replace function staff_tasks_private.video_upload_detail(p_student text, p_class text, p_homework date, p_attempt_at timestamptz)
returns text
language sql stable
as $fn$
  select coalesce(p_student, '학생') || ' · ' || coalesce(p_class, '반') || ' — '
    || case when p_homework is not null
         then to_char(p_homework, 'FMMM"월" FMDD"일"') || '('
              || (array['일', '월', '화', '수', '목', '금', '토'])[extract(dow from p_homework)::int + 1] || ') 숙제 영상을 올리다 멈췄습니다'
         else '어느 숙제인지 고르지 않고 올린 영상'
              || coalesce('(' || to_char(p_attempt_at at time zone 'Asia/Seoul', 'FMMM"월" FMDD"일" HH24:MI') || ')', '') || '이 멈췄습니다'
       end
$fn$;

-- ① 판정
create or replace function staff_tasks_private.video_upload_settle(p_tenant uuid, p_student uuid, p_cycle text)
returns int
language plpgsql security definer set search_path = public
as $fn$
declare
  v_class uuid := nullif(split_part(p_cycle, '|', 1), '')::uuid;
  v_key text := split_part(p_cycle, '|', 2);
  v_date date := case when v_key ~ '^\d{4}-\d{2}-\d{2}$' then v_key::date end;
  v_upload uuid := case when v_key like 'u:%' then substr(v_key, 3)::uuid end;
  v_since timestamptz;
  v_bytes bigint;
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_opened timestamptz;
begin
  if v_upload is not null then
    -- 숙제 없이 올린 시도: 그 시도가 영상을 남겼거나, 그 뒤 같은 학생·반의 숙제 없는 업로드 · 또는 **같은 파일**(크기 ±1%)을 숙제를
    -- 골라 다시 올린 업로드가 영상을 남겼으면(s2_0004 — 숙제 없이 올리기는 숙제 뒤 추가 영상 통로이기도 해서, 다른 숙제 영상으로는 안 닫는다).
    select u.created_at, u.bytes into v_since, v_bytes from public.homework_video_link_uploads u where u.id = v_upload and u.tenant_id = p_tenant;
    if staff_tasks_private.video_upload_landed(p_tenant, v_upload)
       or exists (select 1 from public.homework_video_link_uploads u
                    join public.homework_video_links l on l.id = u.link_id and l.tenant_id = p_tenant
                   where u.tenant_id = p_tenant and l.student_id = p_student and l.class_id = v_class
                     and u.created_at >= coalesce(v_since, now())
                     and (coalesce(u.route ->> 'homeworkDate', '') = '' or abs(u.bytes - v_bytes) <= v_bytes / 100)
                     and staff_tasks_private.video_upload_landed(p_tenant, u.id)) then
      return staff_tasks_private.close_task(p_tenant, 'video_upload_check', p_student, p_cycle, 'done', 'video_arrived', null);
    end if;
  elsif exists (select 1 from public.homework_video_link_uploads u
               join public.homework_video_links l on l.id = u.link_id and l.tenant_id = p_tenant
              where u.tenant_id = p_tenant and l.student_id = p_student and l.class_id = v_class
                and u.route ->> 'homeworkDate' = v_date::text
                and staff_tasks_private.video_upload_landed(p_tenant, u.id))
     or exists (select 1 from public.video_homework_marks m
              where m.tenant_id = p_tenant and m.class_id = v_class and m.student_id = p_student and m.homework_date = v_date
                and m.status = 'submitted') then
    -- 그 숙제 영상이 들어왔다(같은 학생·반·숙제일의 완료 업로드 · 또는 그 숙제 칸이 '완료').
    return staff_tasks_private.close_task(p_tenant, 'video_upload_check', p_student, p_cycle, 'done', 'video_arrived', null);
  end if;
  -- 숙제 취소 = 취소 기록이 있고 지금 그 숙제를 낸 곳(그날 보고서의 영상 과제 · 따로 낸 숙제)이 없을 때(취소 뒤 다시 낸 숙제는 산다 — cancels.ts와 같은 판정).
  if v_date is not null
     and exists (select 1 from public.video_homework_cancels c
                  where c.tenant_id = p_tenant and c.class_id = v_class and c.student_id = p_student and c.homework_date = v_date)
     and not exists (select 1 from public.lesson_reports r
                      where r.tenant_id = p_tenant and r.class_id = v_class and r.student_id = p_student and r.report_date = v_date
                        and r.video_homework = true)
     and not exists (select 1 from public.video_homework_extra_issues x
                      where x.tenant_id = p_tenant and x.class_id = v_class and x.student_id = p_student and x.homework_date = v_date) then
    return staff_tasks_private.close_task(p_tenant, 'video_upload_check', p_student, p_cycle, 'cancelled', 'homework_cancelled', null);
  end if;
  select opened_at into v_opened from public.staff_tasks
   where tenant_id = p_tenant and kind = 'video_upload_check' and subject_id = p_student and cycle = p_cycle;
  if coalesce(v_date, (v_opened at time zone 'Asia/Seoul')::date) < v_today - 14 then
    return staff_tasks_private.close_task(p_tenant, 'video_upload_check', p_student, p_cycle, 'expired', 'upload_window', null);
  end if;
  return 0;
end;
$fn$;

create or replace function staff_tasks_private.open_video_upload_task(p_upload uuid)
returns uuid
language plpgsql security definer set search_path = public
as $fn$
declare
  u record;
  v_cycle text;
  v_assignees uuid[];
  v_id uuid;
  v_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  select up.id, up.tenant_id, up.status, up.route, up.created_at, l.student_id, l.class_id, s.name as student_name, c.class_name, c.teacher_id
    into u
    from public.homework_video_link_uploads up
    join public.homework_video_links l on l.id = up.link_id and l.tenant_id = up.tenant_id
    join public.students s on s.id = l.student_id and s.tenant_id = up.tenant_id and not s.is_test
    join public.classes c on c.id = l.class_id and c.tenant_id = up.tenant_id
   where up.id = p_upload;
  if u.id is null or u.status = 'completed' or u.created_at < staff_tasks_private.kind_start('video_upload_check') then return null; end if;
  v_cycle := staff_tasks_private.video_upload_cycle(u.class_id, u.route, u.id);
  -- 열고 바로 판정한다 — 이미 영상이 들어왔거나 숙제가 취소된 회차는 그 자리에서 닫힌다(그때 이을 실패 알림은 트리거가 읽음으로 — s2_0004).
  select coalesce(
    (select array[x.id] from public.users x where x.id = u.teacher_id and x.tenant_id = u.tenant_id and x.status = 'active'),
    (select array[x.id] from public.users x where x.id::text = u.route ->> 'teacherId' and x.tenant_id = u.tenant_id and x.status = 'active'),
    staff_tasks_private.master_ids(u.tenant_id)) into v_assignees;
  v_id := staff_tasks_private.open_task(
    u.tenant_id, 'video_upload_check', u.student_id, v_cycle,
    '영상 업로드 확인',
    -- 몇 월 며칠(요일) 숙제인지 · 숙제를 안 골랐으면 그렇다고 + 올린 시각(원장 2026-10-28 *"몇일자 숙제인지 더 명확하게"* — s2_0004).
    staff_tasks_private.video_upload_detail(u.student_name, u.class_name, nullif(u.route ->> 'homeworkDate', '')::date, u.created_at),
    '/students/' || u.student_id::text || '?tab=homework-videos#video-upload-log',
    -- 늦음 = 다음 날이 끝날 때까지 영상이 안 들어옴
    ((v_today + 2)::timestamp at time zone 'Asia/Seoul'),
    v_assignees, null);
  if v_id is not null then
    perform staff_tasks_private.video_upload_settle(u.tenant_id, u.student_id, v_cycle);
  end if;
  return v_id;
end;
$fn$;

-- ③ 업로드 트리거 — 열자마자 닫힌 할 일에 잇는 실패 알림은 읽음으로(본문 = 0379a + 그 update 한 곳).
create or replace function staff_tasks_private.tg_video_upload_task()
returns trigger
language plpgsql security definer set search_path = public
as $fn$
declare
  v_task uuid;
  v_student uuid;
  v_class uuid;
  x record;
begin
  if NEW.diagnostic_notified_at is not null and OLD.diagnostic_notified_at is null and NEW.status <> 'completed' then
    v_task := staff_tasks_private.open_video_upload_task(NEW.id);
    if v_task is not null then
      -- 같은 거래에서 방금 넣은 진단 알림(확인번호 = 업로드 번호 앞 8자리)에 잇는다. 할 일이 열자마자 닫혔으면(영상이 이미 들어옴)
      -- 닫힘 트리거가 이 알림을 못 본 뒤라 여기서 읽음으로 찍는다(s2_0004 — 운영 10/26 한 건에 9개가 읽지 않은 채 남았다).
      update public.notifications n set task_id = v_task,
             read_at = case when n.read_at is null
                             and exists (select 1 from public.staff_tasks t where t.id = v_task and t.status <> 'open')
                            then now() else n.read_at end
       where n.tenant_id = NEW.tenant_id and n.type = 'homework_video_upload_failed' and n.task_id is null
         and n.created_at >= now() - interval '1 minute' and n.body like '%확인번호 ' || left(NEW.id::text, 8);
    end if;
  end if;
  if NEW.status = 'completed' and (OLD.status is distinct from 'completed' or OLD.video_id is distinct from NEW.video_id) then
    select l.student_id, l.class_id into v_student, v_class from public.homework_video_links l
     where l.id = NEW.link_id and l.tenant_id = NEW.tenant_id;
    for x in
      select t.cycle from public.staff_tasks t
       where t.tenant_id = NEW.tenant_id and t.kind = 'video_upload_check' and t.subject_id = v_student
         and t.status = 'open' and t.cycle like v_class::text || '|%'
    loop
      perform staff_tasks_private.video_upload_settle(NEW.tenant_id, v_student, x.cycle);
    end loop;
  end if;
  return null;
exception when others then
  return null; -- 할 일 기록이 업로드 기록을 막지 않는다(30분 맞춤이 메운다).
end;
$fn$;


-- ② 이미 있는 할 일 문구를 새 문구로(숙제일 = 회차 뒤쪽 날짜 · 숙제 없는 시도 = 그 업로드의 시각).
update public.staff_tasks t
   set detail = staff_tasks_private.video_upload_detail(
         s.name, c.class_name,
         case when split_part(t.cycle, '|', 2) ~ '^\d{4}-\d{2}-\d{2}$' then split_part(t.cycle, '|', 2)::date end,
         case when split_part(t.cycle, '|', 2) like 'u:%' then
           (select up.created_at from public.homework_video_link_uploads up
             where up.tenant_id = t.tenant_id and up.id = substr(split_part(t.cycle, '|', 2), 3)::uuid) end)
  from public.students s, public.classes c
 where t.kind = 'video_upload_check'
   and s.id = t.subject_id and s.tenant_id = t.tenant_id
   and c.id = nullif(split_part(t.cycle, '|', 1), '')::uuid and c.tenant_id = t.tenant_id;

-- ① 지금 열린 숙제 없는 시도 할 일을 새 판정으로 한 번 맞춘다(업로드가 새로 끝나지 않으면 트리거가 안 돌고 30분 맞춤만 기다리게 된다).
do $$
declare
  x record;
begin
  for x in
    select t.tenant_id, t.subject_id, t.cycle from public.staff_tasks t
     where t.kind = 'video_upload_check' and t.status = 'open' and split_part(t.cycle, '|', 2) like 'u:%'
  loop
    perform staff_tasks_private.video_upload_settle(x.tenant_id, x.subject_id, x.cycle);
  end loop;
end;
$$;

-- ③ 이미 닫힌 이 종류 할 일에 읽지 않은 채 붙은 실패 알림을 읽음으로(닫힘 트리거 `tg_task_closed_read_notifications`와 같은 규칙 —
--    다른 열린 할 일에 이어진 알림은 그대로). 운영 2026-10-28: 10/26 열자마자 닫힌 한 건에 9개.
update public.notifications n set read_at = now()
  from public.staff_tasks t
 where n.task_id = t.id and n.tenant_id = t.tenant_id and n.read_at is null
   and t.kind = 'video_upload_check' and t.status <> 'open'
   and not exists (select 1 from public.staff_task_notifications l join public.staff_tasks o on o.id = l.task_id
                    where l.notification_id = n.id and o.status = 'open');

-- 권한 — 0377a~0380a와 같은 끝맺음(새 문구 함수에 PUBLIC 실행이 남지 않게).
revoke all on all functions in schema staff_tasks_private from public, anon, authenticated;
grant execute on all functions in schema staff_tasks_private to service_role;

commit;
