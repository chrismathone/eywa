-- 0315a — 학부모 **고정 시간 변경**(요일마다 반복되는 정기 배정) + 그 이력 장부.
--
-- 사용자(2026-09-29): *"고정시간 변경하기 … 셀렉된 요일마다 기존 고정시간을 알려주고 다른 바꿀 시간을 선택하면
-- 그 시간으로 고정으로 바꿀 수 있게 … 무슨 이유로 바꾸는지 내용을 받도록"*.
--
-- 🔑 날짜 하루짜리 변경(0229a `shuttle_ride_exceptions`)과 **다른 축**이다 — 이건 정기 배정(`shuttle_riders`) 자체를
--    바꾼다: "매주 수요일 등원 = 1호차 2회차 칠성초 정문". 셔틀 선생님 명단·편성 화면이 그대로 따라간다.
-- 🔑 요일 **하나만** 옮긴다. 배정 한 줄은 여러 요일을 가진다(월~금 등) — 그 줄에서 그 요일을 빼고(그 요일만 있던 줄은
--    지운다: 빈 요일 배열은 0225a 제약 위반), 새 칸의 줄에 그 요일을 더한다(없으면 새 줄).
--    여러 단계라 **함수 하나 = 트랜잭션 하나**로 한다(중간에 끊기면 그 요일에 타는 곳이 사라진다).
-- 🔑 이력은 같은 함수가 쓴다 — 전/후 자리를 글자 스냅샷으로, 사유·행위자와 함께(추가만, 0314a와 같은 규칙).
-- ⚠️ 날짜 하루짜리 변경이 걸린 날은 그 변경이 여전히 이긴다(정기 − 안 탐 + 여기서 탐) — 정기를 바꿔도 그날은 그대로.
--
-- 롤백:
--   drop function if exists public.change_shuttle_regular_ride(uuid, uuid, text, public.day_of_week, uuid, text, text, uuid, text);
--   drop table if exists public.shuttle_rider_history;
set local statement_timeout = '60s';

create table if not exists public.shuttle_rider_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  student_id uuid not null,
  student_name text,
  io_kind text not null,
  weekday text not null,
  before_run_stop_id uuid,
  after_run_stop_id uuid,
  -- "1호차 1회차 · 칠성초 정문". null = 그 요일 배정이 없었다.
  before_label text,
  after_label text,
  reason text,
  actor_kind text not null,
  actor_id uuid,
  actor_name text,
  created_at timestamptz not null default clock_timestamp()
);

comment on table public.shuttle_rider_history is
  '셔틀 고정(정기) 배정 변경 이력(0315a) — 요일 하나의 타는 곳을 바꿀 때마다 한 줄. 추가만 된다.';

create index if not exists shuttle_rider_history_student_idx
  on public.shuttle_rider_history (tenant_id, student_id, created_at desc);

alter table public.shuttle_rider_history enable row level security;
drop policy if exists shuttle_rider_history_tenant_read on public.shuttle_rider_history;
create policy shuttle_rider_history_tenant_read on public.shuttle_rider_history
  for select using (tenant_id = public.auth_tenant_id());

-- 추가만 — 0314a의 막는 함수를 같이 쓴다.
drop trigger if exists tg_shuttle_rider_history_append_only on public.shuttle_rider_history;
create trigger tg_shuttle_rider_history_append_only
  before update or delete on public.shuttle_rider_history
  for each row execute function public.tg_shuttle_ride_exception_history_append_only();

-- 요일 하나의 고정 자리를 옮긴다. 'same' = 이미 그 자리, 'changed' = 옮김. service_role 전용.
create or replace function public.change_shuttle_regular_ride(
  p_tenant_id uuid,
  p_student_id uuid,
  p_io_kind text,
  p_weekday public.day_of_week,
  p_run_stop_id uuid,
  p_reason text,
  p_actor_kind text,
  p_actor_id uuid,
  p_actor_name text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before uuid;
  v_student text;
begin
  if p_io_kind not in ('in', 'out') then
    raise exception 'bad io kind %', p_io_kind;
  end if;

  select run_stop_id into v_before
    from public.shuttle_riders
   where tenant_id = p_tenant_id and student_id = p_student_id and io_kind = p_io_kind and p_weekday = any(weekdays)
   order by created_at
   limit 1;
  if v_before = p_run_stop_id then
    return 'same';
  end if;

  -- ① 그 요일 빼기 — 그 요일만 있던 줄은 지운다(빈 배열은 제약 위반이라 먼저).
  delete from public.shuttle_riders
   where tenant_id = p_tenant_id and student_id = p_student_id and io_kind = p_io_kind
     and weekdays = array[p_weekday];
  update public.shuttle_riders
     set weekdays = array_remove(weekdays, p_weekday), updated_at = now()
   where tenant_id = p_tenant_id and student_id = p_student_id and io_kind = p_io_kind
     and p_weekday = any(weekdays);

  -- ② 새 칸에 그 요일 더하기 — 그 칸 줄이 이미 있으면(다른 요일로) 요일만 더하고, 없으면 새 줄.
  update public.shuttle_riders
     set weekdays = array_append(weekdays, p_weekday), updated_at = now()
   where tenant_id = p_tenant_id and student_id = p_student_id and io_kind = p_io_kind
     and run_stop_id = p_run_stop_id;
  if not found then
    insert into public.shuttle_riders (tenant_id, run_stop_id, student_id, io_kind, weekdays)
    values (p_tenant_id, p_run_stop_id, p_student_id, p_io_kind, array[p_weekday]);
  end if;

  -- ③ 이력.
  select name into v_student from public.students where id = p_student_id;
  insert into public.shuttle_rider_history (
    tenant_id, student_id, student_name, io_kind, weekday,
    before_run_stop_id, after_run_stop_id, before_label, after_label, reason,
    actor_kind, actor_id, actor_name
  ) values (
    p_tenant_id, p_student_id, v_student, p_io_kind, p_weekday::text,
    v_before, p_run_stop_id,
    case when v_before is null then null else public.shuttle_ride_exception_label('add', v_before) end,
    public.shuttle_ride_exception_label('add', p_run_stop_id),
    p_reason, p_actor_kind, p_actor_id, p_actor_name
  );
  return 'changed';
end;
$$;

revoke all on function public.change_shuttle_regular_ride(uuid, uuid, text, public.day_of_week, uuid, text, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.change_shuttle_regular_ride(uuid, uuid, text, public.day_of_week, uuid, text, text, uuid, text)
  to service_role;

notify pgrst, 'reload schema';
