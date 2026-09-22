-- 0274a — 반 운영 기간이 끝나면 그 반 수강 종료일을 운영 종료일로
--
-- 원장(2026-09-18): *"반정보에서 이반의 시작날짜와 종강날짜를 볼 수 있게 할 것. 종강 날짜가 있으면 학생들의 수강 종료일자를
-- 자동으로 종강날짜로 지정할것. (새로 추가시에도, 기존 학생들도)"* → 날짜는 반 수정의 **'운영 기간'**(원장 선택).
--
-- 🔴 **미래 종료일을 미리 박지 않는다**(적대 리뷰 2026-09-18) — 앱의 퇴원·휴원·반 폐지·종강·부분 종료·공지 대상·원생목록 등
--    26곳이 "`end_date`가 비었으면 수강 중"으로 판정한다. 9/21 종료를 오늘 박아 두면 그 사이 퇴원시켜도 특강 수강이 빠지지 않고,
--    반 폐지·공지 대상에서도 사라진다. 그래서 **기간이 끝난 뒤에** 닫는다(기존 '종강' 버튼과 같은 모양 — 종료일이 과거·오늘).
--    끝나기 전에는 반 상세 학생 줄이 "~ 9/21 (운영 종료)"로 **표시만** 한다(앱, 저장 없음).
--
-- 판정 `class_period_closed_end(반)` = 기간이 **이미 끝났고**(지금 유효한 교시 = `valid_to` 없음 또는 오늘(KST) 이후가 0개)
--   마지막 교시 묶음의 종료일이 **미리 적혀 있던** 경우(그 행들이 종료일 이전에 만들어짐)의 그 종료일.
--   🔴 "미리 적혀 있던"이 교시를 다 지워서 생긴 마감 행을 거른다 — 반 수정이 교시를 지우면 옛 행을 **어제**로 마감해 넣는데
--      (`planSlotArchives`), 그 행은 만든 날이 종료일 다음 날이다. 안 거르면 교시를 비우고 저장한 정규 반 전원이 밤사이 닫힌다.
--   ⚠️ 지난 날짜로 운영 종료일을 적고 저장해도(행을 만든 날 > 종료일) 닫지 않는다 — 소급 종료는 '종강' 버튼으로.
--
-- 쓰는 곳:
--   ① 매일 밤(00:35 KST) cron → `close_ended_class_period_enrollments()`: 끝난 반의 열린 수강(시작 ≤ 종료일)을 그 날로 닫는다.
--      기존 학생·끝나기 전에 새로 배정된 학생 모두 여기서 닫힌다. service_role 전용(테넌트를 가로지르는 일괄이라).
--   ② 새 수강 트리거: 이미 끝난 반에 넣는 수강(시작 ≤ 종료일)이면 넣는 순간 닫는다.
-- 🔑 닫은 수강엔 `withdrawal_reason = '운영 기간 종료'`(사유 표시) — 사람이 종료일을 고치면 앱이 이 사유를 지운다.
-- ⚠️ **되살리기는 없다**(재리뷰 2026-09-18) — 끝난 반에 교시를 다시 넣어도 지난 기수 수강은 닫힌 채다(퇴원생까지 되살아나면
--    안 된다). 새 기수는 새로 배정한다. 끝난 반에서 사람이 종료일을 비우면 그 반 기간을 늘리지 않는 한 다음 밤 다시 닫힌다.
-- ⚠️ 시간표 가져오기가 반을 빼면(교시 종료일만 고친다 — 0234a) 그 반도 끝난 반이 되어 남은 수강이 그 날로 닫힌다 — 교시가
--    없는 반에 열린 수강이 남는 것보다 사실에 맞고, 닫힌 학생은 운영실 '반 미배정 재원생'에 잡힌다(2026-09-18 해당 반 0개).
-- 롤백: 스크립트·기억에만 둔다(본문에 붙이지 않는다).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function public.class_period_closed_end(p_class_id uuid)
returns date
language sql
stable
set search_path = public
as $$
  with today as (select (now() at time zone 'Asia/Seoul')::date as d),
  slots as (
    select s.valid_to, (s.created_at at time zone 'Asia/Seoul')::date as made_on
      from public.class_schedules s
     where s.class_id = p_class_id
  ),
  last as (select max(valid_to) as d from slots)
  select case
    when exists (select 1 from slots sl, today t where sl.valid_to is null or sl.valid_to >= t.d) then null
    when (select d from last) is null then null
    when exists (select 1 from slots sl, last l where sl.valid_to = l.d and sl.made_on > l.d) then null
    else (select d from last)
  end;
$$;

comment on function public.class_period_closed_end(uuid) is
  '끝난 운영 기간의 종료일(0274a) — 지금 유효한 교시가 없고 마지막 교시들이 종료일 이전에 적혀 있던 경우만. 아니면 null.';

-- ① 매일 밤 — 끝난 반의 열린 수강을 닫고, 닫은 반마다 한 줄을 돌려준다(cron이 감사로그를 남긴다).
create or replace function public.close_ended_class_period_enrollments()
returns table (tenant_id uuid, class_id uuid, class_name text, period_end date, closed integer)
language plpgsql
set search_path = public
as $$
declare
  r record;
  v_end date;
  n integer;
begin
  for r in
    select c.id, c.tenant_id, c.class_name
      from public.classes c
     where c.is_active
       and exists (select 1 from public.enrollments e where e.class_id = c.id and e.end_date is null)
  loop
    v_end := public.class_period_closed_end(r.id);
    continue when v_end is null;
    update public.enrollments e
       set end_date = v_end, withdrawal_reason = '운영 기간 종료'
     where e.class_id = r.id
       and e.end_date is null
       and e.start_date <= v_end;
    get diagnostics n = row_count;
    if n > 0 then
      tenant_id := r.tenant_id;
      class_id := r.id;
      class_name := r.class_name;
      period_end := v_end;
      closed := n;
      return next;
    end if;
  end loop;
end;
$$;

-- ② 새 수강 — 이미 끝난 반에 넣으면 넣는 순간 닫는다.
create or replace function public.enrollments_end_at_class_period()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_end date;
begin
  if new.end_date is not null then
    return new;
  end if;
  v_end := public.class_period_closed_end(new.class_id);
  if v_end is not null and new.start_date <= v_end then
    new.end_date := v_end;
    new.withdrawal_reason := coalesce(new.withdrawal_reason, '운영 기간 종료');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enrollments_class_period_end on public.enrollments;
create trigger trg_enrollments_class_period_end
  before insert on public.enrollments
  for each row execute function public.enrollments_end_at_class_period();

revoke all on function public.class_period_closed_end(uuid) from public, anon;
revoke all on function public.close_ended_class_period_enrollments() from public, anon, authenticated;
grant execute on function public.class_period_closed_end(uuid) to authenticated, service_role;
grant execute on function public.close_ended_class_period_enrollments() to service_role;

notify pgrst, 'reload schema';
