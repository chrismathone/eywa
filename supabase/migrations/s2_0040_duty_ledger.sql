-- s2_0040 — 의무 장부(duty_items · duty_daily): 학생 단위 일간·월간 업무의 **분모와 분자를 한 표에** (2026-11-09)
--
-- 왜(원장 2026-11-09): *"각 선생님은 학생의 일간·주간·월간 업무를 모두 하나씩 완료할 때마다 업무 완료도가 채워짐 …
--   원장이 따로 지시하거나 살펴보지 않아도 여러 팩터와 업무 완성도를 자연스럽게 관찰하고 확인하고 지시하는 업무 흐름"*
--   지금 있는 네 장치는 같은 일을 네 가지로 센다 — 운영실 '강사별 업무 현황'(실시간 7일 · 저장 없음) · 할 일 staff_tasks(사건형 · 분모 없음) ·
--   직원 포트폴리오(월 사후 · 원장만) · 학생 장치들(창·담당 판정 제각각). 이 표는 그 넷의 **분모(해야 할 일)** 를 미리 적어 두는 장부다.
--
--   duty_items   의무 한 건 = (종류 × 대상 × 회차). 생성기(앱 cron, 시간표·명단·날짜 산수 — AI 없음)가 열고,
--                30분 맞춤(앱 `judge*` 판정 함수 — 운영실·포트폴리오와 **같은 함수**)이 원 표의 사실로 닫는다. 사람이 누르는 버튼이 아니다(0377a와 같은 원칙).
--                cycle: 일간 'YYYY-MM-DD' · 주간 'IYYY-Www' · 월간 'YYYY-MM' · 건별 자유 글.
--                subject_key: 출결 = '<학생 id>|<반 id>'(같은 날 두 반을 듣는 학생은 반마다 한 건 — 리뷰 2026-11-09) ·
--                             보고서 작성·발송 = '<학생 id>|<담당 id>:<과목>'(운영실 분모와 같은 묶음 — 보고서를 어느 반으로 썼든 열쇠가 안 흔들린다 · 실제 반은 class_id) ·
--                             반 단위 의무(영어 반 알림장) = 'class:<반 id>'.
--                status: open(아직) · done(원 표에 사실이 생김 · done_at = 그 사실의 시각) · void(의무가 아니게 됨 — 결석·휴원·반 이동·시간표 변경·종강). void는 분모에서 뺀다.
--                단 void_reason 'expired'(기한 뒤 7일이 지나도록 안 한 것 · `duty_escalate`가 확정)는 **분모에 남고 미완(late)으로** 센다 — 안 한 일을 숨기지 않는다.
--                7일이 지나면 다시 맞추지 않으므로(`duty_open_cycles` 창과 같은 수) 그 뒤에 생긴 사실은 장부에 안 들어온다(리뷰 2026-11-09).
--                owner_id: 일간 = 그 교시를 실제로 가르친 사람(teacher-axis) · 월간·관리 = 과목 대표 담당(counselDutyOf) — 원장 2026-11-09 제안대로.
--                escalation: 0 기한 안 · 1 기한 지남(선생님 할 일 — 그 할 일의 기한은 +1일) · 2 관리자(+3일) · 3 원장(+7일). 되살아나면 0부터.
--   duty_daily   담당자 × 과목 × 종류 × 날 집계 스냅숏(추세 · 주간·월간 창). 맞춤이 어제·오늘을 다시 쓴다(`student_daily_stats` 패턴).
--
-- 늦음의 사다리는 **기존 할 일(staff_tasks)** 을 탄다 — 새 벨·새 아침 요약을 만들지 않는다. 담당자 × 종류 × 회차에 할 일 하나(`duty_late`),
--   제목에 건수. 늦은 것이 하나도 안 남으면 닫힌다 — 하나라도 실제로 처리됐으면 done, 전부 void·담당 변경이면 cancelled(거짓 '처리됨' 금지).
--
-- 🔴 서버 전용(정책 0개 · 0377a와 같은 방식): 앱이 사람을 확인한 뒤 관리 키로 읽는다(담당자 = 내 것 · 원장·관리자 = 범위대로).
-- 배포 순서: **앱보다 먼저**(#95). 앱은 표가 없어도 강사 홈이 죽지 않게 fail-soft(줄이 안 선다).
-- 되돌리기: 스키마 duties_private와 표 duty_daily · duty_items를 지운다(순서대로). 할 일 kind 'duty_late' 행은 닫힌 기록이라 그대로 둬도 된다.
begin;

create schema if not exists duties_private;
revoke all on schema duties_private from public, anon, authenticated;
grant usage on schema duties_private to service_role;

-- ── 표 ──────────────────────────────────────────────────────────────────────
create table if not exists public.duty_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null check (kind ~ '^[a-z_]+$'),
  period text not null check (period in ('daily', 'weekly', 'monthly', 'case')),
  cycle text not null,
  subject_key text not null,
  student_id uuid references public.students(id) on delete cascade,
  class_id uuid references public.classes(id) on delete set null,
  subject text,
  owner_id uuid references public.users(id) on delete set null,
  owner_source text,
  due_at timestamptz not null,
  status text not null default 'open' check (status in ('open', 'done', 'void')),
  done_at timestamptz,
  done_source text,
  void_reason text,
  escalation smallint not null default 0 check (escalation between 0 and 3),
  escalated_at timestamptz,
  task_id uuid references public.staff_tasks(id) on delete set null,
  opened_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint duty_items_subject_key unique (tenant_id, kind, subject_key, cycle)
);
create index if not exists duty_items_owner_cycle_idx on public.duty_items (tenant_id, owner_id, cycle);
create index if not exists duty_items_open_due_idx on public.duty_items (tenant_id, due_at) where status = 'open';
create index if not exists duty_items_student_idx on public.duty_items (tenant_id, student_id) where student_id is not null;
create index if not exists duty_items_class_idx on public.duty_items (tenant_id, class_id) where class_id is not null;
create index if not exists duty_items_task_idx on public.duty_items (task_id) where task_id is not null;
create index if not exists duty_items_kind_cycle_idx on public.duty_items (tenant_id, kind, cycle);

create table if not exists public.duty_daily (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  day date not null,
  owner_id uuid references public.users(id) on delete cascade,
  owner_key text generated always as (coalesce(owner_id::text, '')) stored,
  subject text,
  subject_key text generated always as (coalesce(subject, '')) stored,
  kind text not null,
  period text not null,
  total int not null default 0,
  done int not null default 0,
  on_time int not null default 0,
  late int not null default 0,
  void int not null default 0,
  updated_at timestamptz not null default now(),
  constraint duty_daily_key unique (tenant_id, day, owner_key, subject_key, kind)
);
create index if not exists duty_daily_owner_idx on public.duty_daily (tenant_id, owner_id, day);

alter table public.duty_items enable row level security;
alter table public.duty_daily enable row level security;
revoke all on public.duty_items, public.duty_daily from public, anon, authenticated;
grant all on public.duty_items, public.duty_daily to service_role;

-- ── 종류 이름(할 일 제목용 · 화면 이름의 한 곳은 앱 kinds.ts — 여기는 할 일 제목에만) ───
create or replace function duties_private.kind_label(p_kind text) returns text
language sql immutable
as $fn$
  select case p_kind
    when 'attendance'      then '출결 입력'
    when 'report_write'    then '수업보고서 작성'
    when 'report_send'     then '보고서 발송'
    when 'video_check'     then '영상 숙제 확인'
    when 'counsel_monthly' then '월 학부모 상담'
    when 'exam_monthly'    then '월말평가'
    when 'newcomer_call'   then '신규생 정착 콜'
    else p_kind end;
$fn$;

-- ── 열기(생성기) ────────────────────────────────────────────────────────────
-- 생성기가 그날(또는 그달)의 의무 전부를 넘긴다. 없으면 만들고, 열려 있으면 담당·반·과목만 새로 맞춘다(기한은 처음 그대로 — 0377a와 같은 결).
-- 닫힌 행(done·void)은 손대지 않는다 — 사실로 닫힌 것을 생성기가 되살리지 않는다(되살리기는 resolve의 'open'만).
-- ⚠️ 한 호출 안에 같은 열쇠가 둘이면 21000(cannot affect row a second time) — 앱이 초안을 열쇠로 한 번 거른다(model/daily.ts).
create or replace function public.duty_upsert_items(p_tenant uuid, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = public
as $fn$
declare
  v_inserted int := 0;
  v_updated int := 0;
begin
  with src as (
    select x.kind, x.period, x.cycle, x."subjectKey" as subject_key, x."studentId" as student_id, x."classId" as class_id,
           x.subject, x."ownerId" as owner_id, x."ownerSource" as owner_source, x."dueAt" as due_at
      from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb))
        as x(kind text, period text, cycle text, "subjectKey" text, "studentId" uuid, "classId" uuid, subject text, "ownerId" uuid, "ownerSource" text, "dueAt" timestamptz)
     where x.kind is not null and x.period is not null and x.cycle is not null and x."subjectKey" is not null and x."dueAt" is not null
  ), ins as (
    insert into public.duty_items (tenant_id, kind, period, cycle, subject_key, student_id, class_id, subject, owner_id, owner_source, due_at)
    select p_tenant, s.kind, s.period, s.cycle, s.subject_key,
           -- 같은 학원 학생·반·사람만 잇는다(관리 키로 들어오는 값이라 지점을 한 번 더 본다).
           (select st.id from public.students st where st.id = s.student_id and st.tenant_id = p_tenant),
           (select c.id from public.classes c where c.id = s.class_id and c.tenant_id = p_tenant),
           s.subject,
           (select u.id from public.users u where u.id = s.owner_id and u.tenant_id = p_tenant),
           s.owner_source, s.due_at
      from src s
    on conflict (tenant_id, kind, subject_key, cycle) do update
       set owner_id = excluded.owner_id, owner_source = excluded.owner_source,
           class_id = coalesce(excluded.class_id, duty_items.class_id), subject = coalesce(excluded.subject, duty_items.subject),
           -- 담당이 바뀌면 옛 담당 묶음의 할 일과는 끊는다(새 담당 묶음이 다음 사다리에서 다시 잇는다).
           task_id = case when duty_items.owner_id is distinct from excluded.owner_id then null else duty_items.task_id end,
           updated_at = now()
     where duty_items.status = 'open'
       and (duty_items.owner_id, duty_items.owner_source, coalesce(excluded.class_id, duty_items.class_id), coalesce(excluded.subject, duty_items.subject))
           is distinct from (excluded.owner_id, excluded.owner_source, duty_items.class_id, duty_items.subject)
    returning (xmax = 0) as inserted
  )
  select count(*) filter (where inserted), count(*) filter (where not inserted) into v_inserted, v_updated from ins;
  return jsonb_build_object('inserted', v_inserted, 'updated', v_updated);
end;
$fn$;

-- ── 닫기·되살리기(맞춤) ──────────────────────────────────────────────────────
-- [{kind, subjectKey, cycle, status: 'done'|'void'|'open', source, doneAt}] — done = 원 표에 사실이 생김(done_at = 그 사실의 시각(doneAt) · 없으면 지금 · 처음 한 번) ·
-- void = 의무가 아니게 됨 · open = 사실이 지워졌다(보고서 삭제 · 출결 정정) → 다시 연다(사다리 단계·할 일 연결은 0부터). 같은 상태면 건너뛴다.
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
       and d.status is distinct from s.status
    returning d.status
  )
  select count(*) filter (where status = 'done'), count(*) filter (where status = 'void'), count(*) filter (where status = 'open')
    into v_done, v_void, v_reopened from upd;
  return jsonb_build_object('done', v_done, 'void', v_void, 'reopened', v_reopened);
end;
$fn$;

-- 생성기가 넘긴 명단에 없는 열린 의무(그 종류 · 그 회차)는 void — 학생이 빠졌거나 시간표가 바뀐 것(분모에서 뺀다). 닫힌 행은 그대로.
-- p_rekey(보고서 종류): 열쇠에 담당이 들어 있어 담임이 바뀌면 같은 학생·과목·회차의 열쇠가 바뀐다 — 그때 옛 열쇠 행은 **done이어도** 'rekeyed'로 정리한다
-- (안 그러면 지난 회차를 다시 맞출 때 같은 의무가 두 번 세어진다 · 재리뷰 2026-11-09). 새 열쇠 행이 같은 맞춤에서 사실로 done을 다시 받는다.
create or replace function public.duty_void_stale(p_tenant uuid, p_kind text, p_cycle text, p_keep_keys text[], p_reason text default 'not_due', p_rekey boolean default false) returns int
language plpgsql security definer set search_path = public
as $fn$
declare
  v_n int := 0;
  v_m int := 0;
begin
  update public.duty_items d
     set status = 'void', void_reason = p_reason, updated_at = now()
   where d.tenant_id = p_tenant and d.kind = p_kind and d.cycle = p_cycle and d.status = 'open'
     and not (d.subject_key = any(coalesce(p_keep_keys, '{}')));
  get diagnostics v_n = row_count;
  if p_rekey then
    update public.duty_items d
       set status = 'void', void_reason = 'rekeyed', task_id = null, updated_at = now()
     where d.tenant_id = p_tenant and d.kind = p_kind and d.cycle = p_cycle and d.status <> 'void'
       and d.student_id is not null and not (d.subject_key = any(coalesce(p_keep_keys, '{}')))
       and exists (select 1 from public.duty_items k
                    where k.tenant_id = p_tenant and k.kind = p_kind and k.cycle = p_cycle and k.student_id = d.student_id
                      and k.subject is not distinct from d.subject and k.subject_key = any(coalesce(p_keep_keys, '{}')) and k.id <> d.id);
    get diagnostics v_m = row_count;
  end if;
  return v_n + v_m;
end;
$fn$;

-- 아직 맞춰 볼 회차 — 기한이 지났는데 열린 의무가 남은 일간 회차(최근 p_days일). 앱 cron이 오늘에 더해 이 날들을 다시 맞춘다
-- (다음 날 아침에 보낸 보고서 · 늦게 찍은 출결이 닫히게 — 리뷰 2026-11-09).
create or replace function public.duty_open_cycles(p_tenant uuid, p_days int default 7) returns text[]
language sql stable security definer set search_path = public
as $fn$
  select coalesce(array_agg(distinct d.cycle order by d.cycle), '{}')
    from public.duty_items d
   where d.tenant_id = p_tenant and d.period = 'daily' and d.status = 'open' and d.due_at < now()
     and d.cycle >= to_char((now() at time zone 'Asia/Seoul')::date - p_days, 'YYYY-MM-DD')
     and d.cycle < to_char((now() at time zone 'Asia/Seoul')::date, 'YYYY-MM-DD');
$fn$;

-- ── 늦음 사다리 → 할 일(staff_tasks) ─────────────────────────────────────────
-- 담당자 × 종류 × 회차에 할 일 하나(kind 'duty_late' · subject_id = 그 셋의 md5 uuid · 제목에 건수). 기한 지난 열린 의무가 남아 있으면 열고(제목 갱신),
-- 하나도 안 남으면 닫는다 — 그 할 일에 묶인 의무 중 하나라도 done이면 'done', 기한 지남으로 확정된 것이 있으면 'expired', 아니면(전부 void · 담당 변경으로 옮겨감) 'cancelled'.
-- 담당자가 없거나 퇴사했으면 원장 전원. escalation 단계는 due_at 기준 지남 · +p_manager_days · +p_owner_days.
create or replace function public.duty_escalate(p_tenant uuid, p_manager_days int default 3, p_owner_days int default 7, p_expire_days int default 7) returns jsonb
language plpgsql security definer set search_path = public
as $fn$
declare
  v_now timestamptz := now();
  v_opened int := 0;
  v_closed int := 0;
  v_task uuid;
  g record;
  v_names text;
  v_english boolean;
  v_active boolean;
begin
  -- 기한 뒤 p_expire_days가 지나도록 열린 것은 '기한 지남'으로 확정(void · expired) — 더는 다시 맞추지 않는 날이라(duty_open_cycles 창) 열어 두면 영영 안 닫힌다.
  -- 분모엔 남고 미완으로 센다(snapshot · counts). 할 일은 아래 닫기 루프에서 'expired'.
  update public.duty_items set status = 'void', void_reason = 'expired', updated_at = v_now
   where tenant_id = p_tenant and status = 'open' and due_at + make_interval(days => p_expire_days) < v_now;

  -- 단계 올리기(표시용 — 화면은 이 숫자로 관리자·원장 줄을 가른다).
  update public.duty_items set escalation = 1, escalated_at = coalesce(escalated_at, v_now), updated_at = v_now
   where tenant_id = p_tenant and status = 'open' and escalation < 1 and due_at < v_now;
  update public.duty_items set escalation = 2, updated_at = v_now
   where tenant_id = p_tenant and status = 'open' and escalation < 2 and due_at + make_interval(days => p_manager_days) < v_now;
  update public.duty_items set escalation = 3, updated_at = v_now
   where tenant_id = p_tenant and status = 'open' and escalation < 3 and due_at + make_interval(days => p_owner_days) < v_now;

  -- 담당자 × 종류 × 회차 묶음마다 할 일 하나.
  for g in
    select d.owner_id, d.kind, d.cycle, d.period, count(*) as n, min(d.due_at) as first_due,
           md5(p_tenant::text || ':' || coalesce(d.owner_id::text, 'none') || ':' || d.kind || ':' || d.cycle)::uuid as subject,
           array_agg(d.id) as ids
      from public.duty_items d
     where d.tenant_id = p_tenant and d.status = 'open' and d.due_at < v_now
     group by d.owner_id, d.kind, d.cycle, d.period
  loop
    select string_agg(st.name, ' · ' order by st.name) into v_names
      from public.duty_items d join public.students st on st.id = d.student_id
     where d.id = any(g.ids);
    select bool_or(d.subject = 'english') into v_english from public.duty_items d where d.id = any(g.ids);
    select exists (select 1 from public.users u where u.id = g.owner_id and u.tenant_id = p_tenant and u.status = 'active') into v_active;
    v_task := staff_tasks_private.open_task(
      p_tenant, 'duty_late', g.subject, '',
      duties_private.kind_label(g.kind) || ' 기한 초과 ' || g.n || '건' || case when g.period = 'daily' then ' · ' || to_char(g.cycle::date, 'MM/DD') when g.period = 'monthly' then ' · ' || g.cycle else '' end,
      left(v_names, 300),
      case when g.kind in ('attendance', 'report_write', 'report_send', 'video_check') then (case when coalesce(v_english, false) then '/ecs' else '/onescreen' end) else null end,
      g.first_due + interval '1 day',
      case when g.owner_id is null or not v_active then staff_tasks_private.master_ids(p_tenant) else array[g.owner_id] end,
      null);
    update public.duty_items set task_id = v_task, updated_at = v_now where id = any(g.ids) and task_id is distinct from v_task;
    v_opened := v_opened + 1;
  end loop;

  -- 늦은 의무가 하나도 안 남은 묶음의 할 일은 닫는다. 묶음 열쇠는 같은 md5로 다시 센다.
  for g in
    select t.id, t.subject_id,
           exists (select 1 from public.duty_items d where d.task_id = t.id and d.status = 'done') as any_done,
           exists (select 1 from public.duty_items d where d.task_id = t.id and d.void_reason = 'expired') as any_expired
      from public.staff_tasks t
     where t.tenant_id = p_tenant and t.kind = 'duty_late' and t.status = 'open'
       and not exists (
         select 1 from public.duty_items d
          where d.tenant_id = p_tenant and d.status = 'open' and d.due_at < v_now
            and md5(p_tenant::text || ':' || coalesce(d.owner_id::text, 'none') || ':' || d.kind || ':' || d.cycle)::uuid = t.subject_id)
  loop
    v_closed := v_closed + staff_tasks_private.close_task(p_tenant, 'duty_late', g.subject_id, '',
      case when g.any_done then 'done' when g.any_expired then 'expired' else 'cancelled' end,
      case when g.any_done then 'duties_resolved' when g.any_expired then 'duties_expired' else 'duties_moved_or_void' end, null);
  end loop;
  return jsonb_build_object('opened', v_opened, 'closed', v_closed);
end;
$fn$;

-- ── 일별 스냅숏 ──────────────────────────────────────────────────────────────
-- 그날 기준으로 담당자 × 과목 × 종류 × 주기 집계를 다시 쓴다. 일간 = cycle이 그날 · 주간 = 그 주 · 월간 = 그 달 · 건별 = 그날 열려 있던 것.
-- late = 그날 끝(또는 지금) 기준으로 기한이 지난 열린 것(당일 자정 기한은 그날 끝과 같은 순간이라 `<=` — 하루가 끝났는데 열려 있으면 늦음).
-- on_time = 기한 안에 done(done_at = 원 표의 사실 시각). void는 total에서 뺀다 — 단 'expired'(기한 지남 확정)는 total에 남고 late로 센다.
create or replace function public.duty_snapshot(p_tenant uuid, p_day date) returns int
language plpgsql security definer set search_path = public
as $fn$
declare
  v_cut timestamptz := least(now(), ((p_day + 1)::timestamp at time zone 'Asia/Seoul'));
  v_n int;
begin
  delete from public.duty_daily where tenant_id = p_tenant and day = p_day;
  insert into public.duty_daily (tenant_id, day, owner_id, subject, kind, period, total, done, on_time, late, void)
  select p_tenant, p_day, d.owner_id, d.subject, d.kind, d.period,
         count(*) filter (where d.status <> 'void' or d.void_reason = 'expired'),
         count(*) filter (where d.status = 'done'),
         count(*) filter (where d.status = 'done' and d.done_at <= d.due_at),
         count(*) filter (where (d.status = 'open' and d.due_at <= v_cut) or d.void_reason = 'expired'),
         count(*) filter (where d.status = 'void' and d.void_reason is distinct from 'expired')
    from public.duty_items d
   where d.tenant_id = p_tenant
     and ((d.period = 'daily' and d.cycle = p_day::text)
       or (d.period = 'weekly' and d.cycle = to_char(p_day, 'IYYY-"W"IW'))
       or (d.period = 'monthly' and d.cycle = to_char(p_day, 'YYYY-MM'))
       or (d.period = 'case' and d.opened_at < v_cut and (d.status = 'open' or coalesce(d.done_at, d.updated_at) >= (p_day::timestamp at time zone 'Asia/Seoul'))))
   group by d.owner_id, d.subject, d.kind, d.period;
  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

-- ── 집계(화면) ───────────────────────────────────────────────────────────────
-- 담당자(없으면 전원) × 종류 × 주기 — 회차 창 안의 의무 수(void 제외 · 기한 지남 확정은 포함) · 완료 · 늦음(기한 지남 확정 포함). 일간은 날짜 범위, 월간은 그 달들, 주간은 그 주들.
create or replace function public.duty_counts(p_tenant uuid, p_owner uuid, p_from date, p_to date)
returns table (owner_id uuid, kind text, period text, total bigint, done bigint, late bigint)
language sql stable security definer set search_path = public
as $fn$
  select d.owner_id, d.kind, d.period,
         count(*) filter (where d.status <> 'void' or d.void_reason = 'expired'),
         count(*) filter (where d.status = 'done'),
         count(*) filter (where (d.status = 'open' and d.due_at < now()) or d.void_reason = 'expired')
    from public.duty_items d
   where d.tenant_id = p_tenant
     and (p_owner is null or d.owner_id = p_owner)
     and ((d.period = 'daily' and d.cycle between p_from::text and p_to::text)
       or (d.period = 'weekly' and d.cycle between to_char(p_from, 'IYYY-"W"IW') and to_char(p_to, 'IYYY-"W"IW'))
       or (d.period = 'monthly' and d.cycle between to_char(p_from, 'YYYY-MM') and to_char(p_to, 'YYYY-MM'))
       or (d.period = 'case' and d.status = 'open'))
   group by d.owner_id, d.kind, d.period;
$fn$;

-- ── 권한 ────────────────────────────────────────────────────────────────────
revoke all on function public.duty_upsert_items(uuid, jsonb), public.duty_resolve_items(uuid, jsonb), public.duty_void_stale(uuid, text, text, text[], text, boolean),
  public.duty_open_cycles(uuid, int), public.duty_escalate(uuid, int, int, int), public.duty_snapshot(uuid, date), public.duty_counts(uuid, uuid, date, date) from public, anon, authenticated;
grant execute on function public.duty_upsert_items(uuid, jsonb), public.duty_resolve_items(uuid, jsonb), public.duty_void_stale(uuid, text, text, text[], text, boolean),
  public.duty_open_cycles(uuid, int), public.duty_escalate(uuid, int, int, int), public.duty_snapshot(uuid, date), public.duty_counts(uuid, uuid, date, date) to service_role;
revoke all on all functions in schema duties_private from public, anon, authenticated;
grant execute on all functions in schema duties_private to service_role;

notify pgrst, 'reload schema';
commit;
