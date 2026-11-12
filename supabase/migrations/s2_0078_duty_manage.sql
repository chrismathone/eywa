-- s2_0078 — 업무 완성도: 관리 이력(확인 · 사유 · 면제) + 지연의 실제 배정(3일 → 과목 관리자 · 7일 → 원장) + 평가 개시 전 기간의 집계 (2026-11-10)
--
-- 왜(원장 2026-11-10 *"3일·7일 배정이랑 관리 이력 이어서 만들어"* · *"10월 기록을 총 동원해서 지난달 것도 만들어볼것"*):
--   ① 관리자가 지연을 보고도 남길 수 있는 것이 없었다(봤는지 · 왜 늦었는지 · 안 해도 되는지). ② '3일·7일 이상 지연'은 숫자일 뿐 누구에게도 가지 않았다.
--   ③ 지난달(평가 개시 전) 장부를 기록으로 다시 만들어도 집계가 평가 개시 전 기한을 통째로 빼서 화면이 비었다.
-- 무엇:
--   · `duty_notes` — 의무마다 남기는 관리 기록(ack 확인 · reason 사유 · waive 면제). 지우거나 고치지 않고 덧붙이기만 한다.
--   · `duty_note_add` — 한 번에 여러 의무에 같은 기록을 남긴다. 대상은 **열려 있거나 미이행으로 확정된** 의무만 · 과목 범위(p_subjects) 밖이 섞이면 통째로 거절.
--     면제(waive)는 그 의무를 void('waived')로 — 분모·지연·할 일에서 빠진다(집계는 expired가 아닌 void를 원래 세지 않는다).
--   · `duty_resolve_items` — 면제한 의무는 맞춤이 되살리지 않는다(사람이 내린 결정이 30분 뒤 맞춤에 뒤집히지 않게). 그 밖은 s2_0071 본문 그대로.
--   · `duty_escalate_up` — 늦음 할 일 스위치(late_tasks_on)가 켜져 있을 때만: 기한 뒤 3일이 지난 열린 의무를 **선생님 × 과목**으로 묶어 그 과목 관리자에게,
--     7일이 지난 것(+ 미이행으로 확정된 지 한 주 안의 것 — 일간은 7일째에 확정돼 열린 채로는 못 온다)을 **과목**으로 묶어 원장에게 할 일(`duty_late_up`)로 연다. 과목 관리자 명단은 앱이 넘긴다(판정이 앱의 운영실 배정이라 SQL로 옮기지 않는다).
--     과목 관리자가 없거나 지연한 사람 본인뿐이면 원장에게. 묶음이 사라지면(처리 · 면제 · 확정) 닫는다. 스위치가 꺼지면 전부 닫는다.
--   · `duties_private.rollup_rows` — 고른 기간이 **통째로 평가 개시(live_from) 전**이면 개시 전 기한도 센다(지난달 기록을 참고로 본다). 개시일이 든 기간은 종전대로 뺀다.
--     인자·돌려주는 열은 그대로(공개 집계 함수 셋은 건드리지 않는다).
-- service_role 전용. 되돌리기: duty_escalate_up · duty_note_add를 지우고 duty_notes를 지운 뒤 duty_resolve_items는 s2_0071, rollup_rows는 s2_0076 본문으로.
begin;

create table if not exists public.duty_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  duty_id uuid not null references public.duty_items(id) on delete cascade,
  action text not null check (action in ('ack', 'reason', 'waive')),
  note text not null default '' check (char_length(note) <= 500),
  actor_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists duty_notes_duty_idx on public.duty_notes (duty_id, created_at);
create index if not exists duty_notes_tenant_idx on public.duty_notes (tenant_id, created_at);
alter table public.duty_notes enable row level security;
revoke all on public.duty_notes from public, anon, authenticated;
grant all on public.duty_notes to service_role;

create or replace function public.duty_note_add(p_tenant uuid, p_ids uuid[], p_action text, p_note text, p_actor uuid, p_subjects text[]) returns int
language plpgsql security definer set search_path = public
as $fn$
declare
  v_ids uuid[];
  v_note text := btrim(coalesce(p_note, ''));
  v_n int;
begin
  if p_action not in ('ack', 'reason', 'waive') then raise exception '알 수 없는 처리입니다.'; end if;
  if p_action in ('reason', 'waive') and v_note = '' then raise exception '사유를 적어 주세요.'; end if;
  if char_length(v_note) > 500 then raise exception '사유는 500자까지 적을 수 있습니다.'; end if;
  select array_agg(distinct x) into v_ids from unnest(coalesce(p_ids, '{}')) x;
  if v_ids is null or cardinality(v_ids) > 500 then raise exception '한 번에 처리할 수 있는 항목은 1~500건입니다.'; end if;
  -- 대상을 잠근 채 센다 — 범위 밖 · 이미 끝난 것이 하나라도 섞이면 아무것도 하지 않는다(화면이 낡았다).
  select count(*) into v_n from (
    select 1 from public.duty_items d
     where d.tenant_id = p_tenant and d.id = any(v_ids)
       and (p_subjects is null or d.subject = any(p_subjects))
       and (d.status = 'open' or (d.status = 'void' and d.void_reason = 'expired'))
     for update) t;
  if v_n <> cardinality(v_ids) then raise exception '이미 처리됐거나 볼 수 없는 항목이 섞여 있습니다. 화면을 새로 고친 뒤 다시 해 주세요.'; end if;
  insert into public.duty_notes (tenant_id, duty_id, action, note, actor_id)
  select p_tenant, x, p_action, v_note, (select u.id from public.users u where u.id = p_actor and u.tenant_id = p_tenant) from unnest(v_ids) x;
  if p_action = 'waive' then
    update public.duty_items set status = 'void', void_reason = 'waived', task_id = null, updated_at = now()
     where tenant_id = p_tenant and id = any(v_ids);
  end if;
  return v_n;
end;
$fn$;

-- s2_0071 본문 + 면제한 의무는 건드리지 않는다(한 줄).
create or replace function public.duty_resolve_items(p_tenant uuid, p_updates jsonb) returns jsonb
language plpgsql security definer set search_path = public
as $fn$
declare
  v_done int := 0;
  v_void int := 0;
  v_reopened int := 0;
begin
  with src as (
    select x.kind, x."subjectKey" as subject_key, x.cycle, x.status, x.source, x."doneAt" as done_at
      from jsonb_to_recordset(coalesce(p_updates, '[]'::jsonb)) as x(kind text, "subjectKey" text, cycle text, status text, source text, "doneAt" timestamptz)
     where x.status in ('done', 'void', 'open')
  ), upd as (
    update public.duty_items d
       set status = s.status,
           done_at = case when s.status = 'done' then coalesce(d.done_at, s.done_at, now()) else null end,
           done_source = case when s.status = 'done' then coalesce(s.source, d.done_source) else null end,
           void_reason = case when s.status = 'void' then coalesce(s.source, d.void_reason) else null end,
           escalation = case when s.status = 'open' then 0 else d.escalation end,
           escalated_at = case when s.status = 'open' then null else d.escalated_at end,
           task_id = case when s.status = 'open' then null else d.task_id end,
           updated_at = now()
      from src s
     where d.tenant_id = p_tenant and d.kind = s.kind and d.subject_key = s.subject_key and d.cycle = s.cycle
       and d.void_reason is distinct from 'waived'
       and (d.status is distinct from s.status
            or (s.status = 'void' and s.source is not null and d.void_reason is distinct from s.source))
    returning d.status
  )
  select count(*) filter (where status = 'done'), count(*) filter (where status = 'void'), count(*) filter (where status = 'open')
    into v_done, v_void, v_reopened from upd;
  return jsonb_build_object('done', v_done, 'void', v_void, 'reopened', v_reopened);
end;
$fn$;

-- p_subjects = { "<과목 키>": { "label": "수학", "managers": ["<사람 id>", …] }, … } — 과목 관리자 명단과 과목 이름(앱이 넘긴다).
create or replace function public.duty_escalate_up(p_tenant uuid, p_subjects jsonb, p_manager_days int default 3, p_owner_days int default 7) returns jsonb
language plpgsql security definer set search_path = public
as $fn$
declare
  v_now timestamptz := now();
  v_on boolean := false;
  v_live timestamptz := '-infinity';
  v_opened int := 0;
  v_closed int := 0;
  v_keep uuid[] := '{}';
  v_masters uuid[] := staff_tasks_private.master_ids(p_tenant);
  v_to uuid[];
  v_body text;
  g record;
begin
  select coalesce(s.late_tasks_on, false), coalesce(s.live_from, '-infinity'::timestamptz) into v_on, v_live from public.duty_settings s where s.tenant_id = p_tenant;
  v_on := coalesce(v_on, false); v_live := coalesce(v_live, '-infinity'::timestamptz);

  if v_on then
    -- 3일: 선생님 × 과목 → 그 과목 관리자(지연한 사람 본인은 뺀다 · 남는 사람이 없으면 원장).
    for g in
      select d.owner_id, d.subject, count(*) as n, min(d.due_at) as first_due, array_agg(d.id) as ids,
             md5(p_tenant::text || ':m3:' || coalesce(d.owner_id::text, 'none') || ':' || coalesce(d.subject, ''))::uuid as key,
             coalesce((select u.display_name from public.users u where u.id = d.owner_id), '담당 미정') as teacher
        from public.duty_items d
       where d.tenant_id = p_tenant and d.status = 'open' and d.due_at >= v_live and d.due_at + make_interval(days => p_manager_days) < v_now
       group by d.owner_id, d.subject
    loop
      select string_agg(duties_private.kind_label(k.kind) || ' ' || k.n || '건', chr(10) order by k.n desc) into v_body
        from (select d.kind, count(*) as n from public.duty_items d where d.id = any(g.ids) group by d.kind) k;
      select coalesce(array_agg(x::uuid), '{}') into v_to
        from jsonb_array_elements_text(coalesce(p_subjects -> coalesce(g.subject, '') -> 'managers', '[]'::jsonb)) x
       where x ~ '^[0-9a-f-]{36}$' and x::uuid is distinct from g.owner_id
         and exists (select 1 from public.users u where u.id = x::uuid and u.tenant_id = p_tenant and u.status = 'active');
      if cardinality(v_to) = 0 then v_to := v_masters; end if;
      if staff_tasks_private.open_task(p_tenant, 'duty_late_up', g.key, 'm3',
           g.teacher || ' 선생님 — 3일 이상 지연 ' || g.n || '건', left(coalesce(v_body, ''), 1200), '/duties',
           g.first_due + make_interval(days => p_manager_days + 1), v_to, null) is not null then
        v_keep := v_keep || g.key; v_opened := v_opened + 1;
      end if;
    end loop;
    -- 7일: 과목 → 원장.
    for g in
      select d.subject, count(*) as n, min(d.due_at) as first_due, array_agg(d.id) as ids,
             md5(p_tenant::text || ':o7:' || coalesce(d.subject, ''))::uuid as key
        from public.duty_items d
       where d.tenant_id = p_tenant and d.due_at >= v_live
         and ((d.status = 'open' and d.due_at + make_interval(days => p_owner_days) < v_now)
           -- 일간 의무는 7일째에 미이행으로 확정돼 열린 채로는 여기 오지 못한다 — 확정된 뒤 한 주 동안 원장에게 함께 싣는다.
           or (d.status = 'void' and d.void_reason = 'expired' and d.due_at + make_interval(days => p_owner_days + 7) >= v_now))
       group by d.subject
    loop
      select string_agg(t.teacher || ' ' || t.n || '건', chr(10) order by t.n desc) into v_body
        from (select coalesce(u.display_name, '담당 미정') as teacher, count(*) as n
                from public.duty_items d left join public.users u on u.id = d.owner_id where d.id = any(g.ids) group by 1) t;
      if staff_tasks_private.open_task(p_tenant, 'duty_late_up', g.key, 'o7',
           coalesce(nullif(p_subjects -> coalesce(g.subject, '') ->> 'label', ''), case when g.subject is null then '과목 미정' else '기타 과목' end) || ' — 7일 이상 지연 · 미이행 ' || g.n || '건',
           left(coalesce(v_body, ''), 1200), '/duties', g.first_due + make_interval(days => p_owner_days + 1), v_masters, null) is not null then
        v_keep := v_keep || g.key; v_opened := v_opened + 1;
      end if;
    end loop;
  end if;

  for g in
    select t.subject_id, t.cycle from public.staff_tasks t
     where t.tenant_id = p_tenant and t.kind = 'duty_late_up' and t.status = 'open' and not (t.subject_id = any(v_keep))
  loop
    v_closed := v_closed + staff_tasks_private.close_task(p_tenant, 'duty_late_up', g.subject_id, g.cycle,
      -- 묶음이 사라진 까닭은 여럿이다(처리 · 면제 · 미이행 확정 · 담당 변경) — '처리됨'이라고 단정하지 않는 까닭 글로 닫는다.
      case when v_on then 'done' else 'cancelled' end, case when v_on then 'duties_cleared' else 'late_tasks_off' end, null);
  end loop;
  return jsonb_build_object('opened', v_opened, 'closed', v_closed);
end;
$fn$;

-- s2_0076 본문 + 고른 기간이 통째로 평가 개시 전이면 개시 전 기한도 센다(한 줄). 인자·열은 그대로.
create or replace function duties_private.rollup_rows(p_tenant uuid, p_from date, p_to date, p_subjects text[], p_periods text[], p_owner uuid)
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
     and (d.due_at >= coalesce((select s.live_from from public.duty_settings s where s.tenant_id = p_tenant), '-infinity'::timestamptz)
          or p_to < (select (s.live_from at time zone 'Asia/Seoul')::date from public.duty_settings s where s.tenant_id = p_tenant))
     and (p_subjects is null or d.subject = any(p_subjects))
     and (p_owner is null or d.owner_id = p_owner)
     and duties_private.rollup_window(d.period, d.cycle, d.status, d.due_at, d.done_at, p_from, p_to, p_periods);
$fn$;

revoke all on function public.duty_note_add(uuid, uuid[], text, text, uuid, text[]), public.duty_escalate_up(uuid, jsonb, int, int) from public, anon, authenticated;
grant execute on function public.duty_note_add(uuid, uuid[], text, text, uuid, text[]), public.duty_escalate_up(uuid, jsonb, int, int) to service_role;

notify pgrst, 'reload schema';
commit;
