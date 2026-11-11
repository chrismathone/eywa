-- s2_0067 — 업무 완성도: 퇴원보고서 작성 차례를 '참고 열'로 (2026-11-11)
--
-- 왜: 원장 *"선생님별 업무가 추가될 경우 관리자 화면에서 체크할 수 있나? 퇴원보고서 작성 요청 등"* → Codex와 협의:
--   퇴원보고서 작성(할 일 `withdrawal_step` · cycle `write:<담임>`)만 먼저, 등급 · 전체에는 넣지 않고 참고 열로 본다.
--   🔴 할 일 행은 보완 요청으로 다시 열리면 같은 행의 opened_at · due_at · closed_at을 덮는다(`staff_tasks_private.open_task`) —
--   그 행을 그대로 세면 앞 차례의 제출 실적이 사라진다. 그래서 **차례마다 한 줄**을 따로 남긴다(이 표).
-- 무엇:
--   · public.withdrawal_write_turns — 작성 차례 한 번 = 한 줄(할 일 · 차례 번호 · 보고서 · 맡은 사람 · 열림 · 기한 · 닫힘). 서버 전용(RLS 켜고 정책 0개).
--   · 트리거 staff_tasks_capture_withdrawal_write_turn — 작성 차례 할 일이 생기거나 다시 열리면 새 줄, 닫히면 마지막 줄을 닫는다,
--     열린 채 기한만 바뀌면 마지막 줄의 기한을 맞춘다. 다른 종류의 할 일에는 닿지 않는다(WHEN 절).
--   · 지금까지의 작성 차례(침산 27건)는 그대로 첫 차례로 옮긴다 — 다시 열린 적이 없어(사건 'reopened' 0건) 지금 행이 곧 그 차례다.
--     다시 열린 적이 있는 행은 앞 차례를 알 수 없으니 `legacy`로 표시해 집계에서 뺀다(지어내지 않는다).
--   · public.duty_withdrawal_write_rollup — 기한이 고른 기간에 든 차례를 맡은 사람 × 과목으로 센다(업무 완성도 집계와 같은 칸 모양) +
--     맡은 사람 하나로 접은 줄(subject = null · 여러 과목 보고서를 한 번만 센다 — 과목 줄을 더해 전체를 만들지 않는다).
--   · public.duty_withdrawal_write_items — 같은 조건의 근거 목록(페이지로 읽는다).
--   판정(업무 완성도와 같은 낱말): 때가 됨 = 기한 ≤ 지금 · 기한 내 = 기한 안에 닫힘(done) · 기한 후 완료 · 미처리 = 열린 채 기한 지남.
--   취소(퇴원 요청 취소 · 차례 바뀜)는 분모에서 뺀다 — 선생님 책임이 아니다. 만료는 이 종류에 없다(자동 만료를 새로 걸지 않는다).
--   기간 = 기한이 든 날(KST · 기한이 자정 정각이면 그 전날 — `due_at - 1ms`, 건별 업무의 달 귀속과 같다).
-- 실행권: 앱 service_role만(관리 화면 집계와 같다). 연동 PC 역할은 이 표 · 함수를 쓰지 않는다.
-- 되돌리기: scripts/_oneoff/revert-s2_0067-duty-withdrawal-write-turns.sql(트리거 · 함수만 내린다 — 모인 차례 기록은 지우지 않는다).
begin;

create table if not exists public.withdrawal_write_turns (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  task_id uuid not null references public.staff_tasks(id) on delete cascade,
  turn_no int not null check (turn_no >= 1),
  report_id uuid not null,
  assignee_id uuid,
  opened_at timestamptz not null,
  due_at timestamptz,
  status text not null check (status in ('open', 'done', 'cancelled', 'expired')),
  closed_at timestamptz,
  close_reason text,
  legacy boolean not null default false,
  unique (tenant_id, task_id, turn_no)
);
create index if not exists withdrawal_write_turns_due on public.withdrawal_write_turns (tenant_id, due_at);
alter table public.withdrawal_write_turns enable row level security;
-- 의도적으로 정책 0개 — 서버(관리 키)만 읽는다(#92: 닫힌 이유를 적어 둔다).
revoke all on public.withdrawal_write_turns from public, anon, authenticated;

-- 작성 차례의 맡은 사람 = cycle 'write:<uuid>'의 뒤쪽(모양이 아니면 null).
create or replace function staff_tasks_private.withdrawal_writer_of(p_cycle text)
returns uuid language sql immutable
as $fn$
  select case when p_cycle ~ '^write:[0-9a-fA-F-]{36}$' then substr(p_cycle, 7)::uuid end;
$fn$;

create or replace function staff_tasks_private.capture_withdrawal_write_turn()
returns trigger language plpgsql security definer set search_path = public
as $fn$
declare
  v_last record;
begin
  select w.id, w.turn_no, w.status into v_last from public.withdrawal_write_turns w
   where w.tenant_id = new.tenant_id and w.task_id = new.id order by w.turn_no desc limit 1;
  if tg_op = 'INSERT' or (old.status is distinct from 'open' and new.status = 'open') then
    -- 새 차례(처음 열림 · 다시 열림). 앞 차례가 열린 채 남아 있으면(있을 수 없지만) 닫지 않고 그대로 둔다 — 지어내지 않는다.
    insert into public.withdrawal_write_turns (tenant_id, task_id, turn_no, report_id, assignee_id, opened_at, due_at, status, closed_at, close_reason)
    values (new.tenant_id, new.id, coalesce(v_last.turn_no, 0) + 1, new.subject_id, staff_tasks_private.withdrawal_writer_of(new.cycle),
            new.opened_at, new.due_at, new.status, new.closed_at, new.close_reason)
    on conflict (tenant_id, task_id, turn_no) do nothing;
  elsif v_last.id is not null and v_last.status = 'open' then
    -- 마지막 차례가 닫힘 · 기한 변경(열린 채 p_refresh_due).
    update public.withdrawal_write_turns
       set status = new.status, closed_at = new.closed_at, close_reason = new.close_reason, due_at = new.due_at
     where id = v_last.id;
  end if;
  return null;
end;
$fn$;
revoke all on function staff_tasks_private.capture_withdrawal_write_turn() from public, anon, authenticated;

drop trigger if exists staff_tasks_capture_withdrawal_write_turn on public.staff_tasks;
create trigger staff_tasks_capture_withdrawal_write_turn
  after insert or update of status, due_at on public.staff_tasks
  for each row when (new.kind = 'withdrawal_step' and new.cycle like 'write:%')
  execute function staff_tasks_private.capture_withdrawal_write_turn();

-- 지금까지의 작성 차례 → 첫 차례(다시 열린 적이 있으면 legacy).
insert into public.withdrawal_write_turns (tenant_id, task_id, turn_no, report_id, assignee_id, opened_at, due_at, status, closed_at, close_reason, legacy)
select t.tenant_id, t.id, 1, t.subject_id, staff_tasks_private.withdrawal_writer_of(t.cycle), t.opened_at, t.due_at, t.status, t.closed_at, t.close_reason,
       exists (select 1 from public.staff_task_events e where e.task_id = t.id and e.event = 'reopened')
  from public.staff_tasks t
 where t.kind = 'withdrawal_step' and t.cycle like 'write:%'
on conflict (tenant_id, task_id, turn_no) do nothing;

-- 공통 걸러내기 — 지점 · 기한이 든 날(KST) · 과목 범위(보고서 과목과 겹치면) · 맡은 사람. 취소 · legacy 제외.
create or replace function duties_private.withdrawal_write_rows(p_tenant uuid, p_from date, p_to date, p_subjects text[], p_owner uuid)
returns table (turn_id bigint, task_id uuid, turn_no int, report_id uuid, owner_id uuid, subjects text[], student_id uuid, opened_at timestamptz,
               due_at timestamptz, status text, closed_at timestamptz,
               f_done int, f_due int, f_ontime int, f_late_done int, f_open_late int)
language sql stable
as $fn$
  select w.id, w.task_id, w.turn_no, w.report_id, w.assignee_id, r.subjects, r.student_id, w.opened_at, w.due_at, w.status, w.closed_at,
         (w.status = 'done')::int,
         (w.due_at <= pg_catalog.now())::int,
         (w.status = 'done' and w.closed_at <= w.due_at and w.due_at <= pg_catalog.now())::int,
         (w.status = 'done' and w.closed_at > w.due_at)::int,
         (w.status = 'open' and w.due_at <= pg_catalog.now())::int
    from public.withdrawal_write_turns w
    join public.withdrawal_reports r on r.id = w.report_id and r.tenant_id = w.tenant_id
   where w.tenant_id = p_tenant
     and not w.legacy
     and w.status in ('open', 'done')
     and w.due_at is not null
     and ((w.due_at - interval '1 millisecond') at time zone 'Asia/Seoul')::date between p_from and p_to
     and (p_subjects is null or r.subjects && p_subjects)
     and (p_owner is null or w.assignee_id = p_owner);
$fn$;

-- 맡은 사람 × 과목(보고서 과목마다 · 범위 안의 과목만) + 맡은 사람 하나로 접은 줄(subject = null — 차례를 한 번만 센다).
create or replace function public.duty_withdrawal_write_rollup(p_tenant uuid, p_from date, p_to date, p_subjects text[], p_owner uuid)
returns table (owner_id uuid, subject text, total int, done int, due int, ontime int, late_done int, open_late int, expired int, over7 int)
language sql stable security definer set search_path = public
as $fn$
  with rows as (select * from duties_private.withdrawal_write_rows(p_tenant, p_from, p_to, p_subjects, p_owner)),
  per_subject as (
    select x.owner_id, s.subject, x.f_done, x.f_due, x.f_ontime, x.f_late_done, x.f_open_late
      from rows x cross join lateral unnest(x.subjects) as s(subject)
     where p_subjects is null or s.subject = any(p_subjects)
  )
  select owner_id, subject, count(*)::int, sum(f_done)::int, sum(f_due)::int, sum(f_ontime)::int, sum(f_late_done)::int, sum(f_open_late)::int, 0, 0
    from per_subject group by owner_id, subject
  union all
  select owner_id, null, count(*)::int, sum(f_done)::int, sum(f_due)::int, sum(f_ontime)::int, sum(f_late_done)::int, sum(f_open_late)::int, 0, 0
    from rows group by owner_id;
$fn$;

-- 근거 목록 — 같은 걸러내기 · 학생 이름(보여 줄 것만) · 늦은 것부터.
create or replace function public.duty_withdrawal_write_items(p_tenant uuid, p_from date, p_to date, p_subjects text[], p_owner uuid)
returns table (turn_id bigint, report_id uuid, turn_no int, owner_id uuid, subjects text[], student_id uuid, student_name text, school text, grade text,
               opened_at timestamptz, due_at timestamptz, status text, closed_at timestamptz)
language sql stable security definer set search_path = public
as $fn$
  select x.turn_id, x.report_id, x.turn_no, x.owner_id,
         case when p_subjects is null then x.subjects else array(select s from unnest(x.subjects) s where s = any(p_subjects)) end,
         x.student_id, st.name, st.school, st.grade, x.opened_at, x.due_at, x.status, x.closed_at
    from duties_private.withdrawal_write_rows(p_tenant, p_from, p_to, p_subjects, p_owner) x
    left join public.students st on st.id = x.student_id and st.tenant_id = p_tenant;
$fn$;

revoke all on function staff_tasks_private.withdrawal_writer_of(text),
  duties_private.withdrawal_write_rows(uuid, date, date, text[], uuid),
  public.duty_withdrawal_write_rollup(uuid, date, date, text[], uuid),
  public.duty_withdrawal_write_items(uuid, date, date, text[], uuid) from public, anon, authenticated;
grant execute on function duties_private.withdrawal_write_rows(uuid, date, date, text[], uuid),
  public.duty_withdrawal_write_rollup(uuid, date, date, text[], uuid),
  public.duty_withdrawal_write_items(uuid, date, date, text[], uuid) to service_role;

notify pgrst, 'reload schema';
commit;
