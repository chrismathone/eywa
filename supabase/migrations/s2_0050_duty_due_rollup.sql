-- s2_0050 — 업무 완성도: 판정을 '기한이 온 것 중 제때 끝낸 비율'로 · 도입 전 의무 분리 · 늦음 할 일 스위치 (2026-11-10)
--
-- 왜(원장 계정으로 본 화면 + Claude·Codex 협의 2026-11-10):
--   ① s2_0049의 완료율 = 완료 ÷ 장부 전체 — 말일이 기한인 월 상담·월말평가, 아직 수업 전인 오늘 의무까지 분모에 들어가 선생님 14명이 전원 '미흡'.
--   ② 장부 도입 전에 기한이 지난 신규생 의무 87건이 '7일 이상 지연'으로 판정을 지배했다.
--   ③ 건별(신규생) 의무를 완료일로 창에 넣어, 늦게 처리할수록 지난 달 분모에서 빠졌다(지난 달 성적이 시간이 갈수록 좋아진다).
--   ④ 늦음 할 일(`duty_late`)이 검증 전에 선생님 벨로 나갔다(운영 14건 · 11-10 취소) — 켜고 끄는 문이 DB에 없었다.
-- 고침:
--   · `duty_settings`(지점마다 한 줄): live_from = 평가 시작(이 시각보다 앞선 기한의 의무는 '이관' — 집계·할 일에서 빠지고 화면은 따로 묶는다. null = 이관 없음)
--     · late_tasks_on = 늦음 할 일 생성(기본 꺼짐 — 꺼져 있으면 열린 duty_late를 닫는다) · last_sync_at = 장부를 마지막으로 맞춘 시각(화면의 '기준 시각').
--   · 집계 3종의 열: total · done(진척) + due(기한이 온 것) · ontime(제때 완료) · late_done(늦게 완료) · open_late(지금 지연) · expired(미이행 확정) · over7(7일 넘게 열린 지연).
--     기한 준수율 = ontime ÷ due. 기한 전 의무는 total에만 든다(앱이 '예정'으로 중립 표시).
--   · 건별 의무의 창 = **원래 기한일이 속한 달**(완료일로 옮기지 않는다).
--   · `duty_rollup_student`에 p_owner_none(담당자 없는 의무만 — '담당 미정' 줄을 열 때 다른 선생님 몫이 섞이지 않게).
-- 🔴 집계 본문은 duties_private.rollup_rows 한 곳(SET 절 없는 SQL 함수 = 계획기가 펼친다 · #143). 공개 함수 셋은 묶는 축만 다르다.
-- service_role 전용(정책 0개 표와 같은 문). 되돌리기: s2_0049와 s2_0048의 함수 본문을 다시 적용하고 duty_settings를 지운다.
-- 연동 역할 실행권 확인: duty_rollup_* 집계는 관리 화면(앱 service_role)만 부른다 — 연동 PC 질의·RLS 정책이 지나지 않는다.
begin;

create table if not exists public.duty_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  live_from timestamptz,
  late_tasks_on boolean not null default false,
  last_sync_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.duty_settings enable row level security;
revoke all on public.duty_settings from public, anon, authenticated;
grant all on public.duty_settings to service_role;

-- 창 판정 — 건별(case)은 기한일(기한 = 다음 날 0시이므로 1ms 당겨 그날로)이 p_from ~ p_to가 속한 달 끝 안에 들 때.
create or replace function duties_private.rollup_window(p_period text, p_cycle text, p_status text, p_due timestamptz, p_done timestamptz, p_from date, p_to date, p_periods text[])
returns boolean language sql stable
as $fn$
  select (p_periods is null or p_period = any(p_periods)) and (
       (p_period = 'daily' and p_cycle between p_from::text and p_to::text)
    or (p_period = 'weekly' and p_cycle between pg_catalog.to_char(p_from, 'IYYY-"W"IW') and pg_catalog.to_char(p_to, 'IYYY-"W"IW'))
    or (p_period = 'monthly' and p_cycle between pg_catalog.to_char(p_from, 'YYYY-MM') and pg_catalog.to_char(p_to, 'YYYY-MM'))
    or (p_period = 'case'
        and (p_due - interval '1 millisecond') >= (p_from::timestamp at time zone 'Asia/Seoul')
        and (p_due - interval '1 millisecond') < ((pg_catalog.date_trunc('month', p_to::timestamp) + interval '1 month') at time zone 'Asia/Seoul'))
  );
$fn$;

drop function if exists public.duty_rollup_owner_kind(uuid, date, date, text[], text[], uuid);
drop function if exists public.duty_rollup_class(uuid, date, date, text[], text[], uuid);
drop function if exists public.duty_rollup_student(uuid, date, date, text[], text[], uuid, text, uuid, text, uuid, boolean);
drop function if exists public.duty_rollup_student(uuid, date, date, text[], text[], uuid, text, uuid, text, uuid, boolean, boolean);
drop function if exists duties_private.rollup_rows(uuid, date, date, text[], text[], uuid);

create function duties_private.rollup_rows(p_tenant uuid, p_from date, p_to date, p_subjects text[], p_periods text[], p_owner uuid)
returns table (owner_id uuid, subject text, kind text, period text, class_id uuid, student_id uuid, due_at timestamptz,
               f_done int, f_due int, f_ontime int, f_late_done int, f_open_late int, f_expired int, f_over7 int)
language sql stable
as $fn$
  select d.owner_id, d.subject, d.kind, d.period, d.class_id, d.student_id, d.due_at,
         (d.status = 'done')::int,
         (d.due_at <= pg_catalog.now())::int,
         (d.status = 'done' and d.due_at <= pg_catalog.now() and coalesce(d.done_at, d.due_at) <= d.due_at)::int,
         (d.status = 'done' and d.due_at <= pg_catalog.now() and d.done_at > d.due_at)::int,
         (d.status = 'open' and d.due_at <= pg_catalog.now())::int,
         (d.status = 'void' and d.void_reason = 'expired')::int,
         (d.status = 'open' and d.due_at + interval '7 days' < pg_catalog.now())::int
    from public.duty_items d
   where d.tenant_id = p_tenant
     and (d.status <> 'void' or d.void_reason = 'expired')
     and d.due_at >= coalesce((select s.live_from from public.duty_settings s where s.tenant_id = p_tenant), '-infinity'::timestamptz)
     and (p_subjects is null or d.subject = any(p_subjects))
     and (p_owner is null or d.owner_id = p_owner)
     and duties_private.rollup_window(d.period, d.cycle, d.status, d.due_at, d.done_at, p_from, p_to, p_periods);
$fn$;

create function public.duty_rollup_owner_kind(p_tenant uuid, p_from date, p_to date, p_subjects text[], p_periods text[], p_owner uuid)
returns table (owner_id uuid, subject text, kind text, period text, total bigint, done bigint, due bigint, ontime bigint, late_done bigint, open_late bigint, expired bigint, over7 bigint)
language sql stable security definer set search_path = public
as $fn$
  select r.owner_id, r.subject, r.kind, r.period, count(*), sum(r.f_done), sum(r.f_due), sum(r.f_ontime), sum(r.f_late_done), sum(r.f_open_late), sum(r.f_expired), sum(r.f_over7)
    from duties_private.rollup_rows(p_tenant, p_from, p_to, p_subjects, p_periods, p_owner) r
   group by r.owner_id, r.subject, r.kind, r.period;
$fn$;

create function public.duty_rollup_class(p_tenant uuid, p_from date, p_to date, p_subjects text[], p_periods text[], p_owner uuid)
returns table (class_id uuid, owner_id uuid, subject text, total bigint, done bigint, due bigint, ontime bigint, late_done bigint, open_late bigint, expired bigint, over7 bigint)
language sql stable security definer set search_path = public
as $fn$
  select r.class_id, r.owner_id, r.subject, count(*), sum(r.f_done), sum(r.f_due), sum(r.f_ontime), sum(r.f_late_done), sum(r.f_open_late), sum(r.f_expired), sum(r.f_over7)
    from duties_private.rollup_rows(p_tenant, p_from, p_to, p_subjects, p_periods, p_owner) r
   group by r.class_id, r.owner_id, r.subject;
$fn$;

create function public.duty_rollup_student(p_tenant uuid, p_from date, p_to date, p_subjects text[], p_periods text[], p_owner uuid, p_kind text, p_class uuid, p_subject text, p_student uuid, p_subject_none boolean, p_owner_none boolean)
returns table (student_id uuid, class_id uuid, kind text, total bigint, done bigint, due bigint, ontime bigint, late_done bigint, open_late bigint, expired bigint, over7 bigint, last_due timestamptz)
language sql stable security definer set search_path = public
as $fn$
  select r.student_id, r.class_id, r.kind, count(*), sum(r.f_done), sum(r.f_due), sum(r.f_ontime), sum(r.f_late_done), sum(r.f_open_late), sum(r.f_expired), sum(r.f_over7),
         max(r.due_at) filter (where r.f_open_late = 1 or r.f_expired = 1)
    from duties_private.rollup_rows(p_tenant, p_from, p_to, p_subjects, p_periods, p_owner) r
   where (p_kind is null or r.kind = p_kind)
     and (p_class is null or r.class_id = p_class)
     and (p_subject is null or r.subject = p_subject)
     and (not coalesce(p_subject_none, false) or r.subject is null)
     and (not coalesce(p_owner_none, false) or r.owner_id is null)
     and (p_student is null or r.student_id = p_student)
   group by r.student_id, r.class_id, r.kind;
$fn$;

revoke all on function duties_private.rollup_rows(uuid, date, date, text[], text[], uuid),
  public.duty_rollup_owner_kind(uuid, date, date, text[], text[], uuid), public.duty_rollup_class(uuid, date, date, text[], text[], uuid),
  public.duty_rollup_student(uuid, date, date, text[], text[], uuid, text, uuid, text, uuid, boolean, boolean) from public, anon, authenticated;
grant execute on function duties_private.rollup_rows(uuid, date, date, text[], text[], uuid),
  public.duty_rollup_owner_kind(uuid, date, date, text[], text[], uuid), public.duty_rollup_class(uuid, date, date, text[], text[], uuid),
  public.duty_rollup_student(uuid, date, date, text[], text[], uuid, text, uuid, text, uuid, boolean, boolean) to service_role;

-- ── 늦음 사다리: 할 일 생성은 스위치(late_tasks_on)가 켜진 지점만 · 이관 의무(기한 < live_from)는 할 일에 싣지 않는다 ──
-- 단계 값·기한 지남 확정은 종전대로 돈다(장부의 사실). 스위치가 꺼져 있으면 열린 duty_late를 닫는다(사유 late_tasks_off).
create or replace function public.duty_escalate(p_tenant uuid, p_manager_days int default 3, p_owner_days int default 7, p_expire_days int default 7) returns jsonb
language plpgsql security definer set search_path = public
as $fn$
declare
  v_now timestamptz := now();
  v_opened int := 0;
  v_closed int := 0;
  v_task uuid;
  g record;
  v_body text;
  v_title text;
  v_english boolean;
  v_active boolean;
  v_on boolean := false;
  v_live timestamptz := '-infinity';
begin
  select coalesce(s.late_tasks_on, false), coalesce(s.live_from, '-infinity'::timestamptz) into v_on, v_live from public.duty_settings s where s.tenant_id = p_tenant;
  v_on := coalesce(v_on, false); v_live := coalesce(v_live, '-infinity'::timestamptz);

  update public.duty_items set status = 'void', void_reason = 'expired', updated_at = v_now
   where tenant_id = p_tenant and status = 'open' and period = 'daily' and due_at + make_interval(days => p_expire_days) < v_now;

  update public.duty_items set escalation = 1, escalated_at = coalesce(escalated_at, v_now), updated_at = v_now
   where tenant_id = p_tenant and status = 'open' and escalation < 1 and due_at < v_now;
  update public.duty_items set escalation = 2, updated_at = v_now
   where tenant_id = p_tenant and status = 'open' and escalation < 2 and due_at + make_interval(days => p_manager_days) < v_now;
  update public.duty_items set escalation = 3, updated_at = v_now
   where tenant_id = p_tenant and status = 'open' and escalation < 3 and due_at + make_interval(days => p_owner_days) < v_now;

  if v_on then
    for g in
      select d.owner_id, d.kind, d.period, (case when d.period = 'case' then '' else d.cycle end) as grp_cycle,
             count(*) as n, min(d.due_at) as first_due,
             md5(p_tenant::text || ':' || coalesce(d.owner_id::text, 'none') || ':' || d.kind || ':' || (case when d.period = 'case' then '' else d.cycle end))::uuid as subject,
             array_agg(d.id) as ids
        from public.duty_items d
       where d.tenant_id = p_tenant and d.status = 'open' and d.due_at < v_now and d.due_at >= v_live
       group by d.owner_id, d.kind, d.period, (case when d.period = 'case' then '' else d.cycle end)
    loop
      -- 본문: 학생마다 한 줄. 건별은 "이름 — 항목 · 항목", 그 밖은 "이름 · 반".
      select string_agg(line, chr(10) order by line) into v_body from (
        select st.name || case when g.period = 'case'
                                 then ' — ' || string_agg(duties_private.cycle_label(d.kind, d.cycle), ' · ' order by d.due_at)
                                 else coalesce(' · ' || min(c.class_name), '') end as line
          from public.duty_items d join public.students st on st.id = d.student_id left join public.classes c on c.id = d.class_id
         where d.id = any(g.ids)
         group by st.id, st.name
      ) lines;
      select bool_or(d.subject = 'english') into v_english from public.duty_items d where d.id = any(g.ids);
      select exists (select 1 from public.users u where u.id = g.owner_id and u.tenant_id = p_tenant and u.status = 'active') into v_active;
      v_title := duties_private.kind_label(g.kind) || ' 기한 초과 ' || g.n || '건'
        || case when g.period = 'daily' then ' · ' || to_char(g.grp_cycle::date, 'MM/DD') when g.period = 'monthly' then ' · ' || g.grp_cycle else '' end;
      v_task := staff_tasks_private.open_task(
        p_tenant, 'duty_late', g.subject, '',
        v_title,
        left(coalesce(v_body, ''), 1200),
        case when g.kind in ('attendance', 'report_write', 'report_send', 'video_check') then (case when coalesce(v_english, false) then '/ecs' else '/onescreen' end)
             when g.kind in ('counsel_monthly', 'newcomer_call') then '/consultations/new'
             when g.kind = 'exam_monthly' then '/exams/input' else null end,
        g.first_due + interval '1 day',
        case when g.owner_id is null or not v_active then staff_tasks_private.master_ids(p_tenant) else array[g.owner_id] end,
        null);
      update public.duty_items set task_id = v_task, updated_at = v_now where id = any(g.ids) and task_id is distinct from v_task;
      v_opened := v_opened + 1;
    end loop;
  end if;

  for g in
    select t.id, t.subject_id,
           exists (select 1 from public.duty_items d where d.task_id = t.id and d.status = 'done') as any_done,
           exists (select 1 from public.duty_items d where d.task_id = t.id and d.void_reason = 'expired') as any_expired
      from public.staff_tasks t
     where t.tenant_id = p_tenant and t.kind = 'duty_late' and t.status = 'open'
       and not exists (
         select 1 from public.duty_items d
          where v_on and d.tenant_id = p_tenant and d.status = 'open' and d.due_at < v_now and d.due_at >= v_live
            and md5(p_tenant::text || ':' || coalesce(d.owner_id::text, 'none') || ':' || d.kind || ':' || (case when d.period = 'case' then '' else d.cycle end))::uuid = t.subject_id)
  loop
    v_closed := v_closed + staff_tasks_private.close_task(p_tenant, 'duty_late', g.subject_id, '',
      case when not v_on then 'cancelled' when g.any_done then 'done' when g.any_expired then 'expired' else 'cancelled' end,
      case when not v_on then 'late_tasks_off' when g.any_done then 'duties_resolved' when g.any_expired then 'duties_expired' else 'duties_moved_or_void' end, null);
  end loop;
  return jsonb_build_object('opened', v_opened, 'closed', v_closed);
end;
$fn$;

notify pgrst, 'reload schema';
commit;
