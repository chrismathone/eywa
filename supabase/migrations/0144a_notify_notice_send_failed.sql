-- 0144a: **학부모 공지**(classnote_notices) 발송 실패 → 담당 강사·발송자에게 알림
--
-- 0143a(수업 보고서 발송 실패 알림)의 확장. 원장: "확장해 담당이 필요한 알림으로."
-- 공지도 같은 레일(연동 PC 워커가 ClassNote에 게시)이라 실패 양상이 같다 —
-- `학부모 미가입(초대 필요)`·`보드 미배정`처럼 **사람이 조치해야 끝나는** 실패가 조용히 묻힌다.
--
-- 보고서와 다른 점(설계가 갈리는 이유):
--  · 공지 1건 = **여러 학생**(targets[]) → 실패도 여러 건. 알림은 **수신자당 1건으로 묶는다**(학생마다 울리지 않게).
--  · 수신자가 둘이다 — **담당 강사**(학부모를 초대할 사람, 자기 학생만) + **발송자**(자기가 보낸 게 덜 나갔음, 전체 목록).
--  · 결과가 부분 성공일 수 있다 → `partial`도 실패 알림 대상('전건 성공=success'만 무알림).
--
-- ⚠️ **results[]는 용도가 섞여 있다** — 게시 결과는 `{ok, board, reports[]}`, 회수는 `{board, revoked[]}`,
--    수정은 `{board, reports[]}`. `ok`가 **없는** 항목을 실패로 세면 회수·수정이 전부 오탐이 된다
--    (실측 2026-07-23: 회수 2건이 '사유없음 실패'로 잡혔다). 그래서 **`ok` 키가 있고 false인 것만** 실패로 본다.
-- ⚠️ 테스트 타깃(학원이)은 `studentId`가 빈 문자열/null이라 uuid 캐스팅이 터진다 → `nullif(...,'')`로 방어.

-- 1) 실패 사유 → 사람이 할 행동 -----------------------------------------------
--    ⚠️ 0143a(보고서)와 **같은 문구를 쓰기 위해** 함수로 뽑는다. 앱의 humanizeClassnoteError
--    (src/features/report-admin/classnote-error.ts)와도 같은 뜻을 유지할 것 — 세 표면이 같은 실패를
--    다르게 설명하면 원장·강사가 서로 다른 조치를 한다.
create or replace function public.classnote_failure_hint(err text)
returns text
language sql
immutable
as $$
  select case
    when coalesce(err, '') = '' then '사유가 기록되지 않았습니다 — 발송 콘솔에서 확인하세요.'
    when err ilike '%학생 없음%' or err ilike '%미가입%'
      then '학부모가 ClassNote 알림장에 연결되어 있지 않습니다 — 학부모를 초대한 뒤 다시 발송하세요.'
    when err ilike '%보드 미배정%' or err ilike '%배정 필요%'
      then '학생이 ClassNote 알림장에 배정되지 않았습니다 — 배정한 뒤 다시 발송하세요.'
    when err ilike '%보드 없음%' or err ilike '%프로비저닝%'
      then 'ClassNote 알림장이 아직 없습니다 — 알림장 생성 후 다시 발송하세요.'
    else err
  end;
$$;

-- 0143a 트리거도 같은 함수를 쓰도록 교체(문구 이중 관리 제거).
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
  select c.teacher_id into v_recipient
  from public.classes c
  where c.id = NEW.class_id and c.teacher_id is not null;

  if v_recipient is null and coalesce(NEW.teacher_name, '') <> '' then
    select u.id into v_recipient
    from public.users u
    where u.tenant_id = NEW.tenant_id and u.status = 'active' and u.display_name = NEW.teacher_name
    limit 1;
  end if;

  select s.name into v_student from public.students s where s.id = NEW.student_id;
  v_hint := public.classnote_failure_hint(NEW.classnote_error);

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
  when others then return NEW; -- best-effort: 알림이 발송 상태 기록을 막지 않는다
end;
$$;

-- 2) 공지 실패 알림 트리거 함수 -----------------------------------------------
create or replace function public.notify_notice_send_failed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fails jsonb;
  v_n int;
  v_all text;   -- 실패 학생 전체 목록(발송자·master용)
  v_hint text;  -- 대표 사유
  v_mixed boolean;
  v_by_teacher jsonb; -- [{tid, names}] — 담당 강사별 "그 강사의 실패 학생" 목록
begin
  if jsonb_typeof(NEW.results) <> 'array' then return NEW; end if;

  -- 실패 타깃 추출 — **`ok` 키가 있고 false인 것만**(회수·수정 결과 오탐 방지, 헤더 주석 참조).
  select coalesce(jsonb_agg(jsonb_build_object(
           'sid',  nullif((select tt->>'studentId' from jsonb_array_elements(NEW.targets) tt
                            where tt->>'board' = r->>'board' limit 1), ''),
           'name', coalesce((select tt->>'studentName' from jsonb_array_elements(NEW.targets) tt
                              where tt->>'board' = r->>'board' limit 1), r->>'board'),
           'note', r->>'note')), '[]'::jsonb)
    into v_fails
  from jsonb_array_elements(NEW.results) r
  where r ? 'ok' and (r->>'ok')::boolean is not true;

  v_n := jsonb_array_length(v_fails);
  if v_n = 0 then return NEW; end if;

  select string_agg(distinct f->>'name', ', '),
         public.classnote_failure_hint(min(f->>'note')),
         count(distinct coalesce(f->>'note', '')) > 1
    into v_all, v_hint, v_mixed
  from jsonb_array_elements(v_fails) f;

  -- ① 담당 강사 — **자기 학생만** 담아 보낸다(남의 학생 이름을 굳이 뿌리지 않는다). 수신자당 1건.
  --    ⚠️ 학생이 두 반(다른 강사)을 들으면 양쪽 다 담당이므로 둘 다 받는다(초대할 수 있는 사람이 둘).
  select coalesce(jsonb_agg(jsonb_build_object('tid', q.teacher_id, 'names', q.names)), '[]'::jsonb)
    into v_by_teacher
  from (
    select c.teacher_id, string_agg(distinct f->>'name', ', ') as names
    from jsonb_array_elements(v_fails) f
    join public.enrollments e on e.student_id = (f->>'sid')::uuid and e.end_date is null
    join public.classes c on c.id = e.class_id and c.teacher_id is not null
    where f->>'sid' is not null
    group by c.teacher_id
  ) q;

  insert into public.notifications (tenant_id, recipient_id, type, title, body, link, actor_id)
  select NEW.tenant_id, (x->>'tid')::uuid, 'notice_send_failed', '학부모 공지 발송 실패',
         (x->>'names') || ' — ' || v_hint, '/lesson-reports?tab=notice', null
  from jsonb_array_elements(v_by_teacher) x;

  -- ② 발송자 — 자기가 보낸 공지가 덜 나갔다는 사실(전체 목록). 이미 담당으로 받은 사람이면 생략.
  if NEW.created_by is not null
     and not exists (select 1 from jsonb_array_elements(v_by_teacher) x where (x->>'tid')::uuid = NEW.created_by) then
    insert into public.notifications (tenant_id, recipient_id, type, title, body, link, actor_id)
    values (NEW.tenant_id, NEW.created_by, 'notice_send_failed', '학부모 공지 발송 실패',
            v_all || ' — ' || v_hint || case when v_mixed then ' (사유 여러 건)' else '' end,
            '/lesson-reports?tab=notice', null);
  end if;

  -- ③ 아무에게도 못 보냈으면 master 폴백(알림이 사라지지 않게).
  if jsonb_array_length(v_by_teacher) = 0 and NEW.created_by is null then
    insert into public.notifications (tenant_id, recipient_id, type, title, body, link, actor_id)
    select NEW.tenant_id, u.id, 'notice_send_failed', '학부모 공지 발송 실패',
           v_all || ' — ' || v_hint, '/lesson-reports?tab=notice', null
    from public.users u
    where u.tenant_id = NEW.tenant_id and u.status = 'active' and u.system_role = 'master';
  end if;

  return NEW;
exception
  when others then return NEW; -- best-effort: 알림이 공지 상태 기록을 막지 않는다
end;
$$;

-- 3) 트리거 — 게시 결과가 **failed/partial로 바뀌는 전이**에서만(전건 성공·회수·수정 전이는 무알림).
drop trigger if exists trg_notify_notice_send_failed on public.classnote_notices;
create trigger trg_notify_notice_send_failed
after update of status on public.classnote_notices
for each row
when (NEW.status in ('failed', 'partial') and OLD.status is distinct from NEW.status)
execute function public.notify_notice_send_failed();

comment on function public.notify_notice_send_failed() is
  '학부모 공지 게시가 실패/일부실패하면 담당 강사(자기 학생)와 발송자(전체)에게 벨 알림 — 0144a';
comment on function public.classnote_failure_hint(text) is
  'ClassNote 발송 실패 사유 → 사람이 할 행동. 0143a·0144a 트리거 공용(앱 humanizeClassnoteError와 같은 뜻 유지)';
