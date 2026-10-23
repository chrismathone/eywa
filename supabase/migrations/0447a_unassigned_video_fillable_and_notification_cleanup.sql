-- 0447a: 미배정 영상 할 일 = 붙일 빈 숙제가 있을 때만 · 할 일이 끝난 알림은 읽음 · 30일 지난 안 읽은 알림은 보관함 (2026-10-23)
--
-- 왜(원장 2026-10-23):
--   ① *"숙제가 없는데도 미배정 영상이 남아있으면 그건 알림 오류"* · *"이영준은 이미 다 배정된거같은데 알림이 온거같은데"* — 이영준 10/15:
--      10/13 숙제 링크로 올린 영상이 그 칸을 채운 3분 뒤 '숙제 없이 올리기'로 둘째 영상(메모 "10월13일 2단원")을 올렸다. 숙제 넷이 다 영상으로
--      찼는데 그 둘째 영상 때문에 '미배정 영상' 할 일이 섰다. 운영 DB 열린 30건 중 다수가 이 모양(숙제가 다 찬 학생의 남은 영상).
--      → 앱(`fillableCells`)이 미배정 영상 중 **붙일 빈 숙제가 있는 것**만 알림·할 일로 넘기고, 나머지(p_moot)의 열린 할 일은 '취소'
--        (close_reason = no_open_homework)로 닫는다. 장부의 '영상 배정' 버튼·필터는 그대로(붙일 수는 있다 — 2026-10-22 결정).
--   ② *"해결되지 않은 알림은 계속 남아있나?"* → *"고쳐"* — 안 읽은 알림은 영구 보존이라 9,110건(85%)이 쌓였고, 할 일이 다 끝났는데도
--      안 읽은 알림이 100건이었다.
--      → 연결된 할 일이 모두 닫히면 그 알림을 읽음으로(트리거) · 30일 넘게 안 읽은 알림은 보관함으로(매일 정리 cron이 부른다 — 지우지 않는다).
--
-- 변경:
--   1) staff_task_sync_unassigned_videos — p_moot 인자 추가(기본 '{}'). 옛 4인자 함수는 지운다(같은 이름 두 벌이면 PostgREST가 못 고른다).
--      옛 앱이 4개 이름 인자로 불러도 기본값으로 돈다(앱보다 먼저 적용 — #95). 본문은 0379a 그대로 + p_moot 두 곳.
--   2) notify_unassigned_homework_videos — 0411a 그대로 + 묶음 건수에서 할 일이 이미 닫힌 영상을 뺀다(이번에 넘어온 영상은 센다).
--      rounds.ts의 ⚠️(검사 기록 칸이 받은 영상이 14일 동안 건수에 남는다)도 할 일이 있는 영상은 이걸로 풀린다.
--   3) staff_tasks 상태가 열림 → 닫힘이 되면 그 할 일을 알린 알림(task_id · 연결표)을 읽음으로 — 연결된 다른 할 일이 아직 열려 있으면 그대로.
--      다시 열려도 알림을 안 읽음으로 되돌리지 않는다(열린 일은 '내 할 일'이 보여 준다). 실패해도 닫기는 막지 않는다.
--   4) archive_stale_notifications(일수) — 안 읽은 채 그 일수(최소 7)를 넘긴 알림을 보관함으로. 열린 할 일이 붙은 알림은 그대로. service_role만.
--   5) 한 번 맞춤 — 할 일이 이미 모두 닫힌 안 읽은 알림을 읽음으로 · 30일 넘은 안 읽은 알림을 보관함으로(드라이런 10-23: 약 100 · 약 5,000).
-- 되돌리기: 1)·2)는 0379a·0411a의 본문을 다시 적용(1은 5인자 함수를 지우고) · 3) 트리거와 함수를 지운다 · 4) 함수를 지운다.
--   5)의 데이터는 보관 해제·읽음 해제로만 되돌릴 수 있다(시각이 이 마이그레이션 적용 시각인 줄).

begin;
set local lock_timeout = '5s';

-- ── 1) 미배정 영상 할 일 맞춤 ──────────────────────────────────────────────────
drop function if exists public.staff_task_sync_unassigned_videos(uuid, uuid[], uuid[], uuid[]);
create or replace function public.staff_task_sync_unassigned_videos(p_tenant uuid, p_checked uuid[], p_unmatched uuid[], p_open uuid[],
  p_moot uuid[] default '{}')
returns jsonb
language plpgsql security definer set search_path = public
as $fn$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v record;
  v_assignees uuid[];
  v_id uuid;
  v_opened int := 0;
  v_closed int := 0;
  v_n int;
begin
  if now() < staff_tasks_private.kind_start('video_unassigned') then return jsonb_build_object('opened', 0, 'closed', 0); end if;
  for v in
    select lv.id, lv.student_id, lv.subject, lv.route, lv.posted_at, s.name, raw.teacher_id
      from public.homework_video_ledger_videos lv
      join public.student_homework_videos raw on raw.id = lv.id and raw.tenant_id = p_tenant
      join public.students s on s.id = lv.student_id and s.tenant_id = p_tenant and not s.is_test
     where lv.tenant_id = p_tenant and lv.id = any(coalesce(p_open, '{}')) and lv.status = 'uploaded' and lv.drive_file_id is not null
       and coalesce(lv.route ->> 'manualAssignment', 'false') <> 'true' and coalesce(lv.route ->> 'excluded', 'false') <> 'true'
       and (lv.posted_at at time zone 'Asia/Seoul')::date < v_today
       and (lv.posted_at at time zone 'Asia/Seoul')::date >= v_today - 14
       and not exists (select 1 from public.homework_video_assignments a where a.tenant_id = p_tenant and a.video_id = lv.id)
       -- 0447a: 붙일 빈 숙제가 없는 영상은 열지 않는다(앱이 p_open에서 이미 뺐다 — 겹쳐 오면 닫는 쪽이 이긴다).
       and not (lv.id = any(coalesce(p_moot, '{}')))
  loop
    -- 맡은 사람 = 미배정 알림과 같은 규칙(영상의 선생님 · 영상이 가리키는 반의 담임 · 둘 다 없으면 그 과목 지금 반 담임).
    select coalesce(array_agg(distinct u.id), '{}') into v_assignees from public.users u
     where u.tenant_id = p_tenant and u.status = 'active' and u.system_role <> 'student' and (
       u.id = v.teacher_id
       or exists (select 1 from public.classes c where c.tenant_id = p_tenant and c.teacher_id = u.id and c.id::text = v.route ->> 'classId')
       or (v.teacher_id is null and v.route ->> 'classId' is null and exists (
         select 1 from public.enrollments e join public.classes c on c.id = e.class_id and c.tenant_id = p_tenant
          where e.tenant_id = p_tenant and e.student_id = v.student_id and c.teacher_id = u.id and c.is_active
            and (v.subject is null or c.subject = v.subject) and (e.start_date is null or e.start_date <= v_today)
            and (e.end_date is null or e.end_date >= v_today))));
    v_id := staff_tasks_private.open_task(
      p_tenant, 'video_unassigned', v.id, '',
      '미배정 영상',
      coalesce(v.name, '학생') || ' · ' || to_char(v.posted_at at time zone 'Asia/Seoul', 'MM-DD') || ' 올린 영상 — 숙제에 연결하거나 제외',
      '/onescreen/video-homework?from=' || ((v.posted_at at time zone 'Asia/Seoul')::date - 14)::text || '&to=' || v_today::text,
      -- 늦음 = 다음 날이 끝날 때까지 연결 안 함
      ((v_today + 2)::timestamp at time zone 'Asia/Seoul'),
      v_assignees, null);
    if v_id is not null then
      v_opened := v_opened + 1;
      -- 그 사람의 묶음 알림(안 읽은 '미배정 영상 N건')에 잇는다 — 알림은 같은 줄을 고쳐 쓰므로 연결도 그 줄에 더한다.
      insert into public.staff_task_notifications (notification_id, task_id, tenant_id)
      select n.id, v_id, p_tenant from public.notifications n
       where n.tenant_id = p_tenant and n.type = 'video_homework_unassigned' and n.read_at is null and n.archived_at is null
         and n.recipient_id = any(v_assignees)
      on conflict do nothing;
    end if;
  end loop;
  -- 이번에 판정한 영상 중 미배정이 아닌 것 = 연결됨(검사 기록 칸 · 같은 파일 사본 등 앱 판정 포함).
  for v in
    select t.subject_id from public.staff_tasks t
     where t.tenant_id = p_tenant and t.kind = 'video_unassigned' and t.status = 'open'
       and t.subject_id = any(coalesce(p_checked, '{}')) and not (t.subject_id = any(coalesce(p_unmatched, '{}')))
  loop
    v_closed := v_closed + staff_tasks_private.video_unassigned_settle(p_tenant, v.subject_id, true);
  end loop;
  -- 0447a: 미배정이지만 붙일 빈 숙제가 없는 영상(앱 `fillableCells` — 원장 2026-10-23 "숙제가 없는데도 미배정 영상이 남아있으면 그건 알림 오류").
  -- DB가 아는 사실(손 배정 · 자동 제출 · 지움 · 14일)로 먼저 닫고, 아니면 '취소'(붙일 빈 숙제가 없음). 빈 숙제가 다시 생기면 p_open이 다시 연다.
  for v in
    select t.subject_id from public.staff_tasks t
     where t.tenant_id = p_tenant and t.kind = 'video_unassigned' and t.status = 'open'
       and t.subject_id = any(coalesce(p_moot, '{}'))
  loop
    v_n := staff_tasks_private.video_unassigned_settle(p_tenant, v.subject_id, false);
    if v_n = 0 then
      v_n := staff_tasks_private.close_task(p_tenant, 'video_unassigned', v.subject_id, null, 'cancelled', 'no_open_homework', null);
    end if;
    v_closed := v_closed + v_n;
  end loop;
  return jsonb_build_object('opened', v_opened, 'closed', v_closed);
end;
$fn$;
revoke all on function public.staff_task_sync_unassigned_videos(uuid, uuid[], uuid[], uuid[], uuid[]) from public, anon, authenticated;
grant execute on function public.staff_task_sync_unassigned_videos(uuid, uuid[], uuid[], uuid[], uuid[]) to service_role;

-- ── 2) 미배정 영상 묶음 알림 건수 ───────────────────────────────────────────────
create or replace function public.notify_unassigned_homework_videos(p_tenant uuid,p_videos uuid[],p_observed_at timestamptz)
returns integer language plpgsql security invoker set search_path=public,pg_temp as $$
declare video record; recipient uuid; event_id uuid; count_sent integer:=0; today date:=(now() at time zone 'Asia/Seoul')::date;
  fresh uuid[]:='{}'; pending integer; note_id uuid; note_title text; note_link text;
begin
  if p_observed_at is null or p_observed_at<clock_timestamp()-interval '15 minutes' or p_observed_at>clock_timestamp()+interval '1 minute' or cardinality(p_videos)>100 then
    raise exception '영상 상태 확인 요청을 다시 실행해 주세요.'; end if;
  for video in select v.*,s.name,raw.teacher_id,raw.updated_at from public.homework_video_ledger_videos v
    join public.student_homework_videos raw on raw.id=v.id and raw.tenant_id=p_tenant
    join public.students s on s.id=v.student_id and s.tenant_id=p_tenant and not s.is_test
    where v.tenant_id=p_tenant and v.id=any(p_videos) and v.status='uploaded' and v.drive_file_id is not null
      and coalesce(v.route->>'manualAssignment','false')<>'true' and coalesce(v.route->>'excluded','false')<>'true'
      and (v.posted_at at time zone 'Asia/Seoul')::date<today
      and (v.posted_at at time zone 'Asia/Seoul')::date>=today-14
    order by v.student_id,v.id
  loop
    perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||':'||video.student_id::text,0));
    perform id from public.student_homework_videos where tenant_id=p_tenant and id=video.id for update;
    if exists(select 1 from public.student_homework_videos where tenant_id=p_tenant and student_id=video.student_id and updated_at>p_observed_at)
      or exists(select 1 from public.lesson_reports where tenant_id=p_tenant and student_id=video.student_id and created_at>p_observed_at)
      or exists(select 1 from public.video_homework_extra_issues where tenant_id=p_tenant and student_id=video.student_id and issued_at>p_observed_at)
      or exists(select 1 from public.homework_video_assignments where tenant_id=p_tenant and video_id=video.id)
      or exists(select 1 from public.video_homework_auto_outcomes o
        where o.tenant_id=p_tenant and o.video_id=video.id and o.status='submitted' and (
          exists(select 1 from public.lesson_reports r where r.tenant_id=o.tenant_id and r.class_id=o.class_id and r.student_id=o.student_id
            and r.report_date=o.homework_date and r.video_homework=true)
          or exists(select 1 from public.video_homework_extra_issues x where x.tenant_id=o.tenant_id and x.class_id=o.class_id
            and x.student_id=o.student_id and x.homework_date=o.homework_date))) then continue; end if;
    for recipient in select distinct u.id from public.users u where u.tenant_id=p_tenant and u.status='active' and u.system_role<>'student' and (
      u.id=video.teacher_id or exists(select 1 from public.classes c where c.tenant_id=p_tenant and c.teacher_id=u.id and c.id::text=video.route->>'classId')
      or (video.teacher_id is null and video.route->>'classId' is null and exists(
        select 1 from public.enrollments e join public.classes c on c.id=e.class_id and c.tenant_id=p_tenant
        where e.tenant_id=p_tenant and e.student_id=video.student_id and c.teacher_id=u.id and c.is_active
          and (video.subject is null or c.subject=video.subject) and (e.start_date is null or e.start_date<=today) and (e.end_date is null or e.end_date>=today))))
    loop
      event_id:=null;
      insert into public.notification_events(tenant_id,event_type,subject_key,bucket)
        values(p_tenant,'video_homework_unassigned',video.id::text,recipient::text)
        on conflict(tenant_id,event_type,subject_key,bucket) do nothing returning id into event_id;
      if event_id is not null and not (recipient=any(fresh)) then fresh:=array_append(fresh,recipient); end if;
    end loop;
  end loop;
  note_link:='/onescreen/video-homework?from='||(today-14)::text||'&to='||today::text;
  -- 받는 사람 잠금은 늘 같은 순서로(자동 판정 함수와 같은 순서 — 서로 기다리다 멈추지 않게).
  foreach recipient in array coalesce((select array_agg(x order by x::text) from unnest(fresh) x),'{}') loop
    -- 같은 사람의 묶음 줄을 두 거래가 동시에 만들지 않게.
    perform pg_advisory_xact_lock(hashtextextended('video_homework_alert:'||p_tenant::text||':'||recipient::text,0));
    -- 그 사람에게 알린 적 있는 영상 중 지금도 미배정인 것(최근 14일). 🔴 '미배정' 판정은 위 알림 조건과 같은 식이다 —
    -- 다르면 알림은 소모됐는데 건수가 0이라 그 영상을 영영 알리지 않는다(적대적 리뷰 2026-10-13).
    -- 이벤트를 먼저 거른 뒤에 uuid로 바꾼다 — 같은 표의 다른 이벤트 키(반:학생:날짜)가 캐스트에 닿지 않게(실행 계획과 무관하게).
    with ev as materialized (
      select e.subject_key::uuid as video_id from public.notification_events e
      where e.tenant_id=p_tenant and e.event_type='video_homework_unassigned' and e.bucket=recipient::text
        and e.created_at>=now()-interval '20 days')
    select count(*) into pending from ev
      join public.homework_video_ledger_videos v on v.tenant_id=p_tenant and v.id=ev.video_id
      where v.status='uploaded' and v.drive_file_id is not null
        and coalesce(v.route->>'manualAssignment','false')<>'true' and coalesce(v.route->>'excluded','false')<>'true'
        and (v.posted_at at time zone 'Asia/Seoul')::date>=today-14
        and not exists(select 1 from public.homework_video_assignments a where a.tenant_id=p_tenant and a.video_id=v.id)
        -- 0447a: 그 영상의 '미배정 영상' 할 일이 이미 닫혔으면 세지 않는다(앱 판정으로 연결됨 · 붙일 빈 숙제가 없어 취소) — 할 일이 없으면 종전대로.
        -- 이번에 넘어온 영상은 센다 — 알림 조건과 건수가 어긋나 알림을 소모하고 0건이 되지 않게(위 🔴).
        and (v.id=any(p_videos) or not exists(select 1 from public.staff_tasks t
          where t.tenant_id=p_tenant and t.kind='video_unassigned' and t.subject_id=v.id and t.status<>'open'))
        and not exists(select 1 from public.video_homework_auto_outcomes o
          where o.tenant_id=p_tenant and o.video_id=v.id and o.status='submitted' and (
            exists(select 1 from public.lesson_reports r where r.tenant_id=o.tenant_id and r.class_id=o.class_id and r.student_id=o.student_id
              and r.report_date=o.homework_date and r.video_homework=true)
            or exists(select 1 from public.video_homework_extra_issues x where x.tenant_id=o.tenant_id and x.class_id=o.class_id
              and x.student_id=o.student_id and x.homework_date=o.homework_date)));
    if pending<1 then continue; end if;
    note_title:='미배정 영상 '||pending::text||'건이 있습니다';
    note_id:=null;
    select id into note_id from public.notifications where tenant_id=p_tenant and recipient_id=recipient
      and type='video_homework_unassigned' and read_at is null and archived_at is null order by created_at desc limit 1 for update;
    if note_id is not null then
      update public.notifications set title=note_title,body='영상 제출 현황에서 숙제를 연결해 주세요.',link=note_link,created_at=now() where id=note_id;
    else
      insert into public.notifications(tenant_id,recipient_id,type,title,body,link)
        values(p_tenant,recipient,'video_homework_unassigned',note_title,'영상 제출 현황에서 숙제를 연결해 주세요.',note_link);
    end if;
    count_sent:=count_sent+1;
  end loop;
  return count_sent;
end $$;
revoke all on function public.notify_unassigned_homework_videos(uuid,uuid[],timestamptz) from public,anon,authenticated;
grant execute on function public.notify_unassigned_homework_videos(uuid,uuid[],timestamptz) to service_role;

-- ── 3) 할 일이 끝난 알림은 읽음 ────────────────────────────────────────────────
create or replace function staff_tasks_private.tg_task_closed_read_notifications()
returns trigger
language plpgsql security definer set search_path = public
as $fn$
begin
  with cand as (
    select n.id, n.task_id from public.notifications n where n.task_id = NEW.id and n.read_at is null
    union
    select n.id, n.task_id from public.staff_task_notifications l join public.notifications n on n.id = l.notification_id
     where l.task_id = NEW.id and n.read_at is null
  )
  update public.notifications n set read_at = now()
    from cand c
   where n.id = c.id and n.read_at is null
     and not exists (select 1 from public.staff_tasks t where t.id = c.task_id and t.status = 'open')
     and not exists (select 1 from public.staff_task_notifications l join public.staff_tasks t on t.id = l.task_id
                      where l.notification_id = c.id and t.status = 'open');
  return null;
exception when others then
  return null;
end;
$fn$;
revoke all on function staff_tasks_private.tg_task_closed_read_notifications() from public, anon, authenticated;

drop trigger if exists trg_staff_task_closed_read_notifications on public.staff_tasks;
create trigger trg_staff_task_closed_read_notifications
  after update of status on public.staff_tasks
  for each row when (OLD.status = 'open' and NEW.status <> 'open')
  execute function staff_tasks_private.tg_task_closed_read_notifications();

-- ── 4) 오래 안 읽은 알림은 보관함 ───────────────────────────────────────────────
create or replace function public.archive_stale_notifications(p_days integer default 30)
returns integer
language sql security definer set search_path = public
as $fn$
  with moved as (
    update public.notifications n set archived_at = now()
     where n.read_at is null and n.archived_at is null
       and n.created_at < now() - make_interval(days => greatest(coalesce(p_days, 30), 7))
       and not exists (select 1 from public.staff_tasks t where t.id = n.task_id and t.status = 'open')
       and not exists (select 1 from public.staff_task_notifications l join public.staff_tasks t on t.id = l.task_id
                        where l.notification_id = n.id and t.status = 'open')
    returning 1
  )
  select count(*)::int from moved;
$fn$;
revoke all on function public.archive_stale_notifications(integer) from public, anon, authenticated;
grant execute on function public.archive_stale_notifications(integer) to service_role;

-- ── 5) 한 번 맞춤 ──────────────────────────────────────────────────────────────
update public.notifications n set read_at = now()
 where n.read_at is null
   and (n.task_id is not null or exists (select 1 from public.staff_task_notifications l where l.notification_id = n.id))
   and not exists (select 1 from public.staff_tasks t where t.id = n.task_id and t.status = 'open')
   and not exists (select 1 from public.staff_task_notifications l join public.staff_tasks t on t.id = l.task_id
                    where l.notification_id = n.id and t.status = 'open');
select public.archive_stale_notifications(30);

commit;
notify pgrst, 'reload schema';
