-- s2_0017 — 업무 요청: 요청 → 담당자 확인·처리 보고 → 관리자 검토 → 마감 (2026-11-02)
--
-- 왜: 원장 *"그렇게 추천방식으로 해보자"* · *"기존 2.0은 아무 이상 없도록 별도로 적용"* — 3.0 AX의 업무 흐름을 2.0에 녹이는 2단계.
--     결정 본문 = docs/decisions/dashboard.md 'AX는 2.0에 녹인다'.
-- 🔴 **새 표 넷 · 새 함수 둘만 더한다.** 기존 표·함수·트리거는 건드리지 않고 알림·벨·슬랙·할 일(staff_tasks)과도 잇지 않는다.
--    기존 할 일은 원래 기록의 사실로 닫힌다(0377a) — 사람이 보고를 쓰는 것은 이 업무 요청뿐이다(원장이 고른 예외).
-- 🔴 쓰기·읽기 = 서버만(service_role). 사용자 정책을 두지 않는다(0377a와 같다 — 정책 0개라 PostgREST로 직접 읽어도 0행).
--    서버가 사람을 확인하고(요청자·담당자·검토자·현황 권한), 함수가 행 잠금 안에서 같은 판정을 한 번 더 한다.
-- 학생 연결은 근거일 뿐이다 — 학생 기록을 바꾸지 않는다(학생 사실로 자동 확정하지 않음).
-- 순서: 이 SQL을 먼저 적용한 뒤 앱을 배포한다(앱은 표가 없으면 업무 흐름 구역을 그리지 않는다 — #95).

begin;

set local lock_timeout = '5s';

create table if not exists public.work_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- 업무 문서 종류 — 일반 · 주간보고 · 기획안 · 교육 · 인수인계 · 개선안(화면 라벨은 앱 한 곳).
  category text not null default 'general'
    check (category in ('general', 'weekly', 'plan', 'training', 'handover', 'improvement')),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  -- 내용 = 서식 글(전자결재와 같은 편집기 HTML · 앱이 저장 전 sanitizeRichHtml로 거른다) — 담당자별 학생 목록이 들어가 4,000자로는 모자랐다(같은 날 20,000으로 올림).
  body text not null default '' check (char_length(body) <= 20000),
  -- 완료 기준 — 무엇이 되면 끝났다고 보나(검토자가 이걸 보고 승인한다).
  done_criteria text not null default '' check (char_length(done_criteria) <= 1000),
  requested_by uuid references public.users(id) on delete set null,
  -- 검토자 — 비어 있으면 요청자가 검토한다.
  reviewer_id uuid references public.users(id) on delete set null,
  due_on date,
  -- 어디서 만들었나(대시보드 '확인할 일' 줄 키 등) — 표시용, 판정에 쓰지 않는다.
  source text check (source is null or char_length(source) <= 40),
  status text not null default 'working' check (status in ('working', 'review', 'closed', 'cancelled')),
  review_note text check (review_note is null or char_length(review_note) <= 1000),
  closed_at timestamptz,
  closed_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists work_requests_tenant_idx on public.work_requests (tenant_id, status, created_at desc);
create index if not exists work_requests_requested_by_idx on public.work_requests (requested_by);
create index if not exists work_requests_reviewer_idx on public.work_requests (reviewer_id);
create index if not exists work_requests_closed_by_idx on public.work_requests (closed_by);

-- 담당자마다 한 줄 — 확인 → 처리 보고. 모두 보고하면 요청이 검토로 넘어간다.
create table if not exists public.work_request_assignees (
  request_id uuid not null references public.work_requests(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  state text not null default 'ready' check (state in ('ready', 'acked', 'reported')),
  acked_at timestamptz,
  reported_at timestamptz,
  outcome text check (outcome in ('done', 'partial', 'blocked')),
  -- 실행 증거 · 결과(사람이 쓴 보고).
  report_note text check (report_note is null or char_length(report_note) <= 2000),
  -- 보완 요청을 받았을 때 그 사유(다시 보고하면 그대로 남는다 — 이력은 사건 기록에).
  returned_note text check (returned_note is null or char_length(returned_note) <= 1000),
  primary key (request_id, user_id)
);
create index if not exists work_request_assignees_user_idx on public.work_request_assignees (tenant_id, user_id);

-- 근거로 잇는 대상 — 지금은 학생만(학생ID). 학생마다 **맡은 담당자**가 있다(원장 *"담당에 담당 학생이 배정되는것처럼"*) —
-- 같은 학생을 두 담당자가 맡을 수 있고(과목이 다른 두 담임), 담당 미정(null)은 근거로만 남는다. 이름은 만들 때의 이름(표시용).
create table if not exists public.work_request_links (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.work_requests(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  target_type text not null check (target_type in ('student')),
  target_id uuid not null,
  assignee_id uuid references public.users(id) on delete set null,
  label text not null default '' check (char_length(label) <= 120),
  constraint work_request_links_uniq unique nulls not distinct (request_id, target_type, target_id, assignee_id)
);
create index if not exists work_request_links_target_idx on public.work_request_links (tenant_id, target_type, target_id);
create index if not exists work_request_links_assignee_idx on public.work_request_links (assignee_id);

-- 사건 기록 — 사람이 한 일과 상태가 바뀐 일만(변경 이력).
create table if not exists public.work_request_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  request_id uuid not null references public.work_requests(id) on delete cascade,
  at timestamptz not null default now(),
  actor_id uuid references public.users(id) on delete set null,
  kind text not null check (kind in ('created', 'acked', 'reported', 'to_review', 'returned', 'approved', 'cancelled')),
  note text check (note is null or char_length(note) <= 2000)
);
create index if not exists work_request_events_request_idx on public.work_request_events (request_id, at);
create index if not exists work_request_events_actor_idx on public.work_request_events (actor_id);

alter table public.work_requests enable row level security;
alter table public.work_request_assignees enable row level security;
alter table public.work_request_links enable row level security;
alter table public.work_request_events enable row level security;
revoke all on public.work_requests, public.work_request_assignees, public.work_request_links, public.work_request_events from public, anon, authenticated;
grant all on public.work_requests, public.work_request_assignees, public.work_request_links, public.work_request_events to service_role;

-- 만들기 — 담당자·검토자는 같은 지점의 재직 직원, 학생은 같은 지점 학생만. 이름은 DB에서 읽어 적는다(화면 값을 믿지 않는다).
-- p_links = [{"student": 학생 id, "assignee": 맡을 담당자 id 또는 null}] — 담당자 목록에 없는 사람이면 담당 미정으로 남긴다.
create or replace function public.work_request_create(
  p_tenant uuid, p_actor uuid, p_category text, p_title text, p_body text, p_criteria text,
  p_due date, p_reviewer uuid, p_assignees uuid[], p_links jsonb, p_source text
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
  v_people uuid[] := array(select distinct x from unnest(coalesce(p_assignees, '{}')) as x where x is not null);
  v_students uuid[] := array(select distinct (e ->> 'student')::uuid from jsonb_array_elements(coalesce(p_links, '[]'::jsonb)) as e where e ->> 'student' is not null);
  v_staff constant text := 'active';
begin
  if not exists (select 1 from users u where u.id = p_actor and u.tenant_id = p_tenant and u.status::text = v_staff) then
    raise exception '요청할 수 있는 계정이 아닙니다';
  end if;
  if cardinality(v_people) = 0 then raise exception '담당자를 한 명 이상 골라 주세요'; end if;
  if cardinality(v_people) > 30 then raise exception '담당자는 30명까지 고를 수 있습니다'; end if;
  if (select count(*) from users u where u.id = any (v_people) and u.tenant_id = p_tenant and u.status::text = v_staff and u.system_role::text <> 'student') <> cardinality(v_people) then
    raise exception '담당자를 다시 골라 주세요(퇴사했거나 이 학원 직원이 아닌 사람이 있습니다)';
  end if;
  if p_reviewer is not null and not exists (select 1 from users u where u.id = p_reviewer and u.tenant_id = p_tenant and u.status::text = v_staff and u.system_role::text <> 'student') then
    raise exception '검토자를 다시 골라 주세요';
  end if;
  if cardinality(v_students) > 300 then raise exception '학생은 300명까지 이을 수 있습니다'; end if;
  if (select count(*) from students s where s.id = any (v_students) and s.tenant_id = p_tenant) <> cardinality(v_students) then
    raise exception '이을 학생을 다시 골라 주세요';
  end if;
  if p_due is not null and p_due < (now() at time zone 'Asia/Seoul')::date then raise exception '기한은 오늘 이후로 골라 주세요'; end if;

  insert into work_requests (tenant_id, category, title, body, done_criteria, requested_by, reviewer_id, due_on, source)
  values (p_tenant, coalesce(p_category, 'general'), btrim(p_title), coalesce(p_body, ''), coalesce(p_criteria, ''), p_actor, p_reviewer, p_due, p_source)
  returning id into v_id;
  insert into work_request_assignees (request_id, tenant_id, user_id) select v_id, p_tenant, x from unnest(v_people) as x;
  insert into work_request_links (request_id, tenant_id, target_type, target_id, assignee_id, label)
    select distinct v_id, p_tenant, 'student', s.id, case when l.assignee = any (v_people) then l.assignee end, left(coalesce(s.name, ''), 120)
    from (select (e ->> 'student')::uuid as student, nullif(e ->> 'assignee', '')::uuid as assignee from jsonb_array_elements(coalesce(p_links, '[]'::jsonb)) as e) as l
    join students s on s.id = l.student and s.tenant_id = p_tenant
    on conflict do nothing;
  insert into work_request_events (tenant_id, request_id, actor_id, kind, note)
    values (p_tenant, v_id, p_actor, 'created', format('담당 %s명%s', cardinality(v_people), case when cardinality(v_students) > 0 then format(' · 학생 %s명', cardinality(v_students)) else '' end));
  return v_id;
end;
$$;

-- 단계 진행 — 확인(ack) · 보고(report) · 승인(approve) · 보완 요청(return) · 취소(cancel). 요청 행을 잠그고 판정한다
-- (두 담당자가 동시에 마지막 보고를 해도 검토로 한 번만 넘어간다). 돌려주는 값 = 요청의 새 상태.
create or replace function public.work_request_act(
  p_tenant uuid, p_request uuid, p_actor uuid, p_action text, p_outcome text, p_note text, p_targets uuid[]
) returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  r work_requests%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_step work_request_assignees%rowtype;
  v_left int;
  v_count int;
begin
  select * into r from work_requests where id = p_request and tenant_id = p_tenant for update;
  if not found then raise exception '업무 요청을 찾지 못했습니다'; end if;

  if p_action in ('ack', 'report') then
    if r.status <> 'working' then raise exception '지금은 보고할 수 없는 업무입니다'; end if;
    select * into v_step from work_request_assignees where request_id = p_request and user_id = p_actor for update;
    if not found then raise exception '이 업무의 담당자가 아닙니다'; end if;
    if p_action = 'ack' then
      if v_step.state <> 'ready' then return r.status; end if;
      update work_request_assignees set state = 'acked', acked_at = now() where request_id = p_request and user_id = p_actor;
      insert into work_request_events (tenant_id, request_id, actor_id, kind) values (p_tenant, p_request, p_actor, 'acked');
    else
      if v_step.state = 'reported' then raise exception '이미 보고했습니다'; end if;
      if p_outcome is null or p_outcome not in ('done', 'partial', 'blocked') then raise exception '처리 결과를 골라 주세요'; end if;
      if v_note is null or char_length(v_note) < 2 then raise exception '무엇을 했는지 적어 주세요'; end if;
      update work_request_assignees
        set state = 'reported', acked_at = coalesce(acked_at, now()), reported_at = now(), outcome = p_outcome, report_note = left(v_note, 2000)
        where request_id = p_request and user_id = p_actor;
      insert into work_request_events (tenant_id, request_id, actor_id, kind, note) values (p_tenant, p_request, p_actor, 'reported', left(v_note, 2000));
      select count(*) into v_left from work_request_assignees where request_id = p_request and state <> 'reported';
      if v_left = 0 then
        update work_requests set status = 'review', updated_at = now() where id = p_request;
        insert into work_request_events (tenant_id, request_id, kind) values (p_tenant, p_request, 'to_review');
        return 'review';
      end if;
    end if;
    update work_requests set updated_at = now() where id = p_request;
    return r.status;
  end if;

  if p_action in ('approve', 'return') then
    if p_actor is distinct from coalesce(r.reviewer_id, r.requested_by) and p_actor is distinct from r.requested_by then
      raise exception '이 업무의 검토자가 아닙니다';
    end if;
    if p_action = 'approve' then
      if r.status <> 'review' then raise exception '모든 담당자가 보고한 뒤에 승인할 수 있습니다'; end if;
      update work_requests set status = 'closed', review_note = left(v_note, 1000), closed_at = now(), closed_by = p_actor, updated_at = now() where id = p_request;
      insert into work_request_events (tenant_id, request_id, actor_id, kind, note) values (p_tenant, p_request, p_actor, 'approved', left(v_note, 2000));
      return 'closed';
    end if;
    if r.status not in ('working', 'review') then raise exception '지금은 보완 요청을 할 수 없는 업무입니다'; end if;
    if v_note is null or char_length(v_note) < 2 then raise exception '무엇을 보완할지 적어 주세요'; end if;
    update work_request_assignees
      set state = 'acked', reported_at = null, returned_note = left(v_note, 1000)
      where request_id = p_request and state = 'reported' and (p_targets is null or cardinality(p_targets) = 0 or user_id = any (p_targets));
    get diagnostics v_count = row_count;
    if v_count = 0 then raise exception '보완을 요청할 보고가 없습니다'; end if;
    update work_requests set status = 'working', updated_at = now() where id = p_request;
    insert into work_request_events (tenant_id, request_id, actor_id, kind, note) values (p_tenant, p_request, p_actor, 'returned', left(v_note, 2000));
    return 'working';
  end if;

  if p_action = 'cancel' then
    if p_actor is distinct from r.requested_by then raise exception '요청한 사람만 취소할 수 있습니다'; end if;
    if r.status not in ('working', 'review') then raise exception '이미 끝난 업무입니다'; end if;
    update work_requests set status = 'cancelled', closed_at = now(), closed_by = p_actor, review_note = left(v_note, 1000), updated_at = now() where id = p_request;
    insert into work_request_events (tenant_id, request_id, actor_id, kind, note) values (p_tenant, p_request, p_actor, 'cancelled', left(v_note, 2000));
    return 'cancelled';
  end if;

  raise exception '알 수 없는 처리입니다';
end;
$$;

revoke all on function public.work_request_create(uuid, uuid, text, text, text, text, date, uuid, uuid[], jsonb, text) from public, anon, authenticated;
revoke all on function public.work_request_act(uuid, uuid, uuid, text, text, text, uuid[]) from public, anon, authenticated;
grant execute on function public.work_request_create(uuid, uuid, text, text, text, text, date, uuid, uuid[], jsonb, text) to service_role;
grant execute on function public.work_request_act(uuid, uuid, uuid, text, text, text, uuid[]) to service_role;

comment on table public.work_requests is
  '업무 요청(s2_0017) — 요청 → 담당자 확인·처리 보고 → 관리자 검토 → 마감. 사람이 보고를 쓰는 유일한 업무 흐름(기존 할 일은 사실로 자동 판정). 서버 전용.';

commit;

notify pgrst, 'reload schema';
