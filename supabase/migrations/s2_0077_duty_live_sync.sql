-- s2_0077 — 업무 완성도: 저장 즉시 반영의 바닥 — 변경 대상 기록(duty_dirty) + 맞춤 잠금 (2026-11-10)
--
-- 왜: 원장 2026-11-10 *"출결이나 상담같이 실시간 체크 가능한것들은 실시간 반영되게 하는게 합리적임. 오해를 사지 않게."* 장부는 30분 크론만 맞춰서
--   출결을 찍어도 '내 업무' 칸과 관리자 화면이 그대로였다(크론이 없는 환경에선 영영).
-- 어떻게: 원 표(출결 · 수업보고서 · 반 알림장 · 원생상담 · 신규생 체크 · 성적)에 **"어느 날(달)이 바뀌었나"만 적는 트리거**를 건다 — 판정은 하지 않는다.
--   화면이 장부를 읽기 직전(그리고 크론)에 `duty_sync_claim`으로 적힌 날을 가져가 기존 맞춤 함수(앱 `syncDailyDuties` · `syncMonthlyDuties`)로 그날만 다시 맞춘다.
--   저장 경로가 몇 곳이든(원스크린 · 월별 출석부 · 자리 PIN · 키오스크 · 엑셀 가져오기 · 연동 PC) 빠지지 않고, 저장 자체는 한 줄 쓰기만 더한다.
-- 🔴 트리거는 **저장을 막지 않는다** — 본문 전체를 exception으로 감싸고(출결 저장은 전원이 매일 쓰는 경로 · #95), 기다릴 일(유니크 충돌)을 만들지 않는다. 실패하면 그 변경은 크론이 30분 안에 맞춘다.
-- 🔴 변경 기록은 **덧붙이기만** 한다(같은 날 유니크 없음) — 유니크 충돌 대기가 없어 긴 저장 거래가 다른 저장을 줄 세우지 않고, 저장마다 제 줄을 남겨 묻히지 않는다.
--   아무도 가져가지 않는 동안(1시간 넘은 줄이 남아 있음)에는 같은 날을 더 적지 않는다 — 표가 끝없이 자라지 않게.
-- 🔴 가져가기는 **지우지 않고 표식만** 한다(`claimed` = 이번 맞춤의 증표). 맞춤이 성공으로 끝날 때 그 증표가 붙은 줄만 지운다 —
--   맞춤이 도중에 죽어도(시간 초과) 줄이 남아 다음 차례가 다시 맞추고, 맞추는 도중 들어온 저장은 표식 없는 새 줄이라 다음 차례에 맞춰진다.
-- 맞춤 잠금(`sync_lock_until` + `sync_token`): 화면의 맞춤과 크론이 같은 지점을 동시에 맞추지 않게(늦게 끝난 쪽의 낡은 판정이 덮어쓰지 않게).
--   3분 뒤 저절로 풀리고, 마무리는 **증표가 맞을 때만** 잠금을 푼다(남의 잠금을 풀지 않는다).
-- service_role 전용. 되돌리기: 트리거 6개 · 함수 3개 · duty_dirty를 지우고 duty_settings의 sync_lock_until · sync_token 열을 지운다.
begin;

create table if not exists public.duty_dirty (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  scope text not null check (scope in ('daily', 'monthly')),
  day date not null,
  created_at timestamptz not null default clock_timestamp(),
  claimed uuid
);
-- 첫 판(같은 날 유니크 · 증표 없음)을 이미 적용한 곳에서 다시 돌려도 같은 모양이 되게.
alter table public.duty_dirty drop constraint if exists duty_dirty_pkey;
alter table public.duty_dirty add column if not exists claimed uuid;
alter table public.duty_dirty alter column created_at set default clock_timestamp();
create index if not exists duty_dirty_key_idx on public.duty_dirty (tenant_id, scope, day);
alter table public.duty_dirty enable row level security;
revoke all on public.duty_dirty from public, anon, authenticated;
grant all on public.duty_dirty to service_role;

alter table public.duty_settings add column if not exists sync_lock_until timestamptz, add column if not exists sync_token uuid;

-- 인자: [0] = 'daily' | 'monthly' · [1..] = 날짜를 읽을 칸 이름(date 또는 timestamptz · 'now' = 오늘). 바뀌기 전·후 줄을 둘 다 본다(날짜를 옮긴 수정).
create or replace function duties_private.mark_dirty() returns trigger
language plpgsql security definer set search_path = public
as $fn$
declare
  v_rows jsonb[] := array[]::jsonb[];
  v_row jsonb;
  v_val text;
  v_day date;
  v_seen date[] := array[]::date[];
  i int;
begin
  begin
    if tg_op <> 'DELETE' then v_rows := v_rows || to_jsonb(new); end if;
    if tg_op <> 'INSERT' then v_rows := v_rows || to_jsonb(old); end if;
    foreach v_row in array v_rows loop
      if v_row->>'tenant_id' is null then continue; end if;
      for i in 1 .. tg_nargs - 1 loop
        if tg_argv[i] = 'now' then v_day := (now() at time zone 'Asia/Seoul')::date;
        else
          v_val := v_row->>tg_argv[i];
          if v_val is null then continue; end if;
          v_day := case when length(v_val) = 10 then v_val::date else (v_val::timestamptz at time zone 'Asia/Seoul')::date end;
        end if;
        if tg_argv[0] = 'monthly' then v_day := date_trunc('month', v_day)::date; end if;
        if v_day = any(v_seen) then continue; end if; -- 바뀌기 전·후가 같은 날이면 한 줄만
        v_seen := v_seen || v_day;
        insert into public.duty_dirty (tenant_id, scope, day)
        select (v_row->>'tenant_id')::uuid, tg_argv[0], v_day
         where not exists (select 1 from public.duty_dirty d
                            where d.tenant_id = (v_row->>'tenant_id')::uuid and d.scope = tg_argv[0] and d.day = v_day
                              and d.claimed is null -- 가져간 줄은 곧 지워진다 — 그 줄을 믿고 건너뛰면 맞추는 도중의 저장이 묻힌다
                              and d.created_at < clock_timestamp() - interval '1 hour');
      end loop;
    end loop;
  exception when others then
    null; -- 저장을 막지 않는다 — 놓친 변경은 크론이 맞춘다.
  end;
  return null;
end;
$fn$;
revoke all on function duties_private.mark_dirty() from public, anon, authenticated;

drop trigger if exists trg_duty_dirty on public.attendance_records;
create trigger trg_duty_dirty after insert or update or delete on public.attendance_records for each row execute function duties_private.mark_dirty('daily', 'session_date');
drop trigger if exists trg_duty_dirty on public.lesson_reports;
create trigger trg_duty_dirty after insert or update or delete on public.lesson_reports for each row execute function duties_private.mark_dirty('daily', 'report_date', 'covers_date');
drop trigger if exists trg_duty_dirty on public.classnote_class_posts;
create trigger trg_duty_dirty after insert or update or delete on public.classnote_class_posts for each row execute function duties_private.mark_dirty('daily', 'posted_on');
drop trigger if exists trg_duty_dirty on public.student_consultations;
create trigger trg_duty_dirty after insert or update or delete on public.student_consultations for each row execute function duties_private.mark_dirty('monthly', 'consulted_at');
drop trigger if exists trg_duty_dirty on public.student_onboarding_checks;
create trigger trg_duty_dirty after insert or update or delete on public.student_onboarding_checks for each row execute function duties_private.mark_dirty('monthly', 'now');
drop trigger if exists trg_duty_dirty on public.student_grades;
create trigger trg_duty_dirty after insert or update or delete on public.student_grades for each row execute function duties_private.mark_dirty('monthly', 'taken_on');

-- 맞출 것을 가져간다. p_force = 크론(적힌 것이 없어도 잠그고 전체를 맞춘다). 돌려주는 값:
--   locked(false면 할 일이 없거나 다른 쪽이 맞추는 중) · token(마무리에 돌려줄 증표) · days(바뀐 날) · monthly(월간·건별을 맞출지)
--   · full(오늘 전체까지 — 마지막 전체 맞춤이 p_stale_minutes보다 오래됐을 때).
create or replace function public.duty_sync_claim(p_tenant uuid, p_force boolean default false, p_stale_minutes int default 30) returns jsonb
language plpgsql security definer set search_path = public
as $fn$
declare
  v_now timestamptz := clock_timestamp();
  v_token uuid := gen_random_uuid();
  v_full boolean;
  v_days date[];
  v_monthly boolean;
  v_got uuid;
begin
  insert into public.duty_settings (tenant_id) values (p_tenant) on conflict (tenant_id) do nothing;
  select (s.last_sync_at is null or s.last_sync_at < v_now - make_interval(mins => p_stale_minutes)) into v_full from public.duty_settings s where s.tenant_id = p_tenant;
  if not p_force and not v_full and not exists (select 1 from public.duty_dirty d where d.tenant_id = p_tenant) then
    return jsonb_build_object('locked', false);
  end if;
  update public.duty_settings set sync_lock_until = v_now + interval '3 minutes', sync_token = v_token, updated_at = v_now
   where tenant_id = p_tenant and (sync_lock_until is null or sync_lock_until < v_now)
   returning tenant_id into v_got;
  if v_got is null then return jsonb_build_object('locked', false); end if;
  -- 지금 보이는(커밋된) 줄 전부에 증표를 단다 — 앞선 맞춤이 죽으며 남긴 줄도 함께 가져온다.
  update public.duty_dirty set claimed = v_token where tenant_id = p_tenant;
  select coalesce(array_agg(distinct d.day) filter (where d.scope = 'daily'), array[]::date[]), coalesce(bool_or(d.scope = 'monthly'), false)
    into v_days, v_monthly from public.duty_dirty d where d.tenant_id = p_tenant and d.claimed = v_token;
  return jsonb_build_object('locked', true, 'token', v_token, 'days', to_jsonb(v_days), 'monthly', v_monthly, 'full', v_full or p_force);
end;
$fn$;

-- 맞춤이 끝났다. 증표가 지금 잠금의 것일 때만 움직인다(3분을 넘겨 다른 쪽이 잠금을 가져갔으면 아무것도 하지 않는다 — 줄은 그쪽이 다시 가져갔다).
-- 성공이면 가져갔던 줄을 지우고(전체 맞춤이었으면 기준 시각을 적는다), 실패면 줄을 그대로 둔다(다음 차례가 다시 맞춘다).
create or replace function public.duty_sync_finish(p_tenant uuid, p_token uuid, p_ok boolean, p_full boolean) returns boolean
language plpgsql security definer set search_path = public
as $fn$
declare
  v_got uuid;
begin
  update public.duty_settings set sync_lock_until = null, sync_token = null,
         last_sync_at = case when p_ok and p_full then now() else last_sync_at end, updated_at = now()
   where tenant_id = p_tenant and sync_token = p_token
   returning tenant_id into v_got;
  if v_got is null then return false; end if;
  if p_ok then delete from public.duty_dirty where tenant_id = p_tenant and claimed = p_token;
  else update public.duty_dirty set claimed = null where tenant_id = p_tenant and claimed = p_token;
  end if;
  return true;
end;
$fn$;

revoke all on function public.duty_sync_claim(uuid, boolean, int), public.duty_sync_finish(uuid, uuid, boolean, boolean) from public, anon, authenticated;
grant execute on function public.duty_sync_claim(uuid, boolean, int), public.duty_sync_finish(uuid, uuid, boolean, boolean) to service_role;

notify pgrst, 'reload schema';
commit;
