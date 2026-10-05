-- 0344b — 보강관리 설정 가드 + 교시표 해석
--
-- ① 설정 가드: `tenant_settings.data.makeups`(mode·allowAdditional·pilotSubjects)는 **configure 명령으로만**
--    바뀐다. 원장의 직접 PATCH도, 관리자 클라이언트(service_role)의 직접 변경도 거절한다 — 끄기(off)는
--    "열린 업무·대사 0건"을 확인해야 하는데 직접 쓰기는 그 확인을 건너뛰기 때문이다.
--    · 다른 섹션을 저장하면서 makeups를 **같은 값**으로 다시 쓰는 것은 통과한다(정규화한 값으로 비교).
--    · upsert의 INSERT 단계는 기존 행이 있으면 통과시키고 UPDATE 분기가 판정한다(0281a와 같은 처리).
--    · 0281a/0335a `guard_tenant_settings_write`는 그대로 둔다 — 이 트리거는 추가 가드다.
--    · 기능 목록(`data.modules.disabled`)에 보강관리를 **새로 넣어 끄는 것**도 켜짐·정리 중에는 거절한다 — 화면만 감추면
--      열린 업무·대사가 아무도 못 보는 채로 남는다. 끄려면 설정에서 꺼짐(off)으로 먼저 바꾼다(그때 열린 업무 0건을 확인한다).
-- ② 교시표: 예약 시각은 클라이언트가 보낸 값을 믿지 않고 학원 설정 교시표에서 다시 만든다.
--    평일 = 과목 전용 표 → (영어·침산 방식) 내장 영어 표 → 전역 평일 표 · 주말 = 주말 표. 교시 id = 순번(1부터).
--    ⚠️ 설정에 교시표가 저장돼 있지 않으면 **코드 기본 교시표**로 읽는다 — 아래 default_periods는
--       src/features/timetable/lib/periods.ts(MATH_PERIODS·WEEKEND_PERIODS·ENGLISH_PERIODS)의 **미러**다.
--       그 상수를 바꾸면 이 함수도 같은 커밋에서 바꿀 것(tests/makeup-db/run.mjs의 미러 대조가 어긋남을 잡는다).
-- 멱등: create or replace + drop trigger if exists.

create or replace function makeup_private.tg_guard_makeups_settings() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if makeup_private.in_command() then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    -- 학원 자체가 지워지는 연쇄 삭제는 통과. 그 밖에는 켜진 설정 행을 지워 꺼짐으로 만들 수 없다.
    if makeup_private.normalize_settings(old.data -> 'makeups') ->> 'mode' <> 'off'
       and exists (select 1 from public.tenants t where t.id = old.tenant_id) then
      raise exception '보강관리가 켜져 있어 학원 설정을 지울 수 없습니다 — 먼저 보강관리를 꺼 주세요' using errcode = '42501';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if exists (select 1 from public.tenant_settings t where t.tenant_id = new.tenant_id) then return new; end if;
    if makeup_private.normalize_settings(new.data -> 'makeups') is distinct from makeup_private.normalize_settings(null) then
      raise exception '보강관리 설정은 보강관리 설정 화면에서만 바꿀 수 있습니다' using errcode = '42501';
    end if;
    return new;
  end if;
  if makeup_private.normalize_settings(new.data -> 'makeups')
     is distinct from makeup_private.normalize_settings(old.data -> 'makeups') then
    raise exception '보강관리 설정은 보강관리 설정 화면에서만 바꿀 수 있습니다' using errcode = '42501';
  end if;
  if makeup_private.normalize_settings(new.data -> 'makeups') ->> 'mode' <> 'off'
     and coalesce(new.data #> '{modules,disabled}', '[]'::jsonb) @> '["makeups"]'::jsonb
     and not coalesce(old.data #> '{modules,disabled}', '[]'::jsonb) @> '["makeups"]'::jsonb then
    raise exception '보강관리를 쓰는 중에는 기능 목록에서 끌 수 없습니다 — 먼저 보강관리 설정에서 꺼 주세요' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists tg_guard_makeups_settings_write on public.tenant_settings;
create trigger tg_guard_makeups_settings_write
  before insert or update or delete on public.tenant_settings
  for each row execute function makeup_private.tg_guard_makeups_settings();

-- 코드 기본 교시표의 미러(헤더 주석 참조).
create or replace function makeup_private.default_periods(p_kind text) returns jsonb
language sql immutable set search_path = pg_catalog as $$
  select case p_kind
    when 'weekday' then '[
      {"startTime":"14:30","endTime":"15:25"},{"startTime":"15:25","endTime":"16:20"},
      {"startTime":"16:20","endTime":"17:15"},{"startTime":"17:15","endTime":"18:10"},
      {"startTime":"18:20","endTime":"19:15"},{"startTime":"19:15","endTime":"20:10"},
      {"startTime":"20:10","endTime":"21:05"},{"startTime":"21:05","endTime":"22:00"}]'::jsonb
    when 'weekend' then '[
      {"startTime":"09:00","endTime":"10:00"},{"startTime":"10:00","endTime":"11:00"},
      {"startTime":"11:00","endTime":"12:00"},{"startTime":"12:00","endTime":"13:00"},
      {"startTime":"13:00","endTime":"14:00"},{"startTime":"14:00","endTime":"15:00"},
      {"startTime":"15:00","endTime":"16:00"},{"startTime":"16:00","endTime":"17:00"}]'::jsonb
    when 'english' then '[
      {"startTime":"14:20","endTime":"15:00"},{"startTime":"15:00","endTime":"15:40"},
      {"startTime":"15:40","endTime":"16:20"},{"startTime":"16:20","endTime":"17:00"},
      {"startTime":"17:00","endTime":"17:40"},{"startTime":"17:20","endTime":"18:10"},
      {"startTime":"17:40","endTime":"18:20"},{"startTime":"18:20","endTime":"19:20"},
      {"startTime":"19:20","endTime":"20:10"},{"startTime":"20:20","endTime":"21:10"},
      {"startTime":"21:10","endTime":"22:00"}]'::jsonb
  end
$$;

create or replace function makeup_private.operations(p_tenant uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select ts.data -> 'operations' from public.tenant_settings ts where ts.tenant_id = p_tenant), '{}'::jsonb)
$$;

-- 그 과목·그 날짜에 고를 수 있는 교시(학원 설정 단일 소스). label은 화면·기존 예약 행에 적는 이름.
create or replace function makeup_private.period_table(p_tenant uuid, p_subject text, p_date date)
returns table (pid text, ord integer, start_time time, end_time time, label text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_ops jsonb := makeup_private.operations(p_tenant);
  v_weekend boolean := extract(isodow from p_date) in (6, 7);
  v_plain boolean := coalesce(v_ops ->> 'periodStyle' = 'plain', false);
  v_rows jsonb;
begin
  if v_weekend then
    v_rows := case when jsonb_typeof(v_ops -> 'weekendPeriods') = 'array' and jsonb_array_length(v_ops -> 'weekendPeriods') > 0
                   then v_ops -> 'weekendPeriods' else makeup_private.default_periods('weekend') end;
  else
    select s -> 'weekdayPeriods' into v_rows
      from jsonb_array_elements(case when jsonb_typeof(v_ops -> 'subjects') = 'array'
                                     then v_ops -> 'subjects' else '[]'::jsonb end) s
     where s ->> 'key' = p_subject and jsonb_typeof(s -> 'weekdayPeriods') = 'array'
       and jsonb_array_length(s -> 'weekdayPeriods') > 0
     limit 1;
    if v_rows is null then
      v_rows := case
        when p_subject = 'english' and not v_plain then makeup_private.default_periods('english')
        when jsonb_typeof(v_ops -> 'weekdayPeriods') = 'array' and jsonb_array_length(v_ops -> 'weekdayPeriods') > 0
          then v_ops -> 'weekdayPeriods'
        else makeup_private.default_periods('weekday') end;
    end if;
  end if;
  return query
    select n::text, n::integer, (r ->> 'startTime')::time, (r ->> 'endTime')::time,
      case
        -- 침산 방식 수학 평일: 이름을 안 지었으면 반교시 표기(1-1·1-2). subjectWeekdayPeriods와 같은 규칙.
        when not v_weekend and not v_plain and p_subject in ('math', 'highmath')
             and (jsonb_typeof(r -> 'label') is distinct from 'string' or btrim(r ->> 'label') = n::text || '교시')
          then ceil(n / 2.0)::integer::text || '-' || case when n % 2 = 1 then '1' else '2' end
        when jsonb_typeof(r -> 'label') = 'string' then btrim(r ->> 'label')
        else n::text || '교시'
      end
    from jsonb_array_elements(v_rows) with ordinality x(r, n);
end;
$$;

-- 고른 교시 id를 교시표로 다시 검증해 시각·이름을 만든다(이어진 교시만 한 구간).
create or replace function makeup_private.resolve_periods(
  p_tenant uuid, p_subject text, p_date date, p_ids text[],
  out o_start time, out o_end time, out o_label text, out o_ids text[]
) language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_ords integer[];
  v_first text;
  v_last text;
begin
  if p_ids is null or cardinality(p_ids) = 0 then
    perform makeup_private.fail('invalid', '교시를 골라 주세요');
  end if;
  select array_agg(t.ord order by t.ord) into v_ords
    from makeup_private.period_table(p_tenant, p_subject, p_date) t where t.pid = any (p_ids);
  if coalesce(cardinality(v_ords), 0) <> (select count(distinct x) from unnest(p_ids) x) then
    perform makeup_private.fail('invalid', '학원 설정의 교시표에 없는 교시입니다 — 교시를 다시 골라 주세요');
  end if;
  if v_ords[cardinality(v_ords)] - v_ords[1] <> cardinality(v_ords) - 1 then
    perform makeup_private.fail('invalid', '이어진 교시만 한 번에 잡을 수 있습니다');
  end if;
  select t.start_time, nullif(t.label, '') into o_start, v_first
    from makeup_private.period_table(p_tenant, p_subject, p_date) t where t.ord = v_ords[1];
  select t.end_time, nullif(t.label, '') into o_end, v_last
    from makeup_private.period_table(p_tenant, p_subject, p_date) t where t.ord = v_ords[cardinality(v_ords)];
  if o_end <= o_start then
    perform makeup_private.fail('invalid', '교시 시각이 올바르지 않습니다 — 학원 설정의 교시표를 확인해 주세요');
  end if;
  o_ids := array(select o::text from unnest(v_ords) o order by o);
  -- 주말 교시는 '주말' 접두(평일 교시와 이름이 겹치지 않게). reservationPeriodLabel과 같은 규칙.
  if v_first is not null and extract(isodow from p_date) in (6, 7) and left(v_first, 2) <> '주말' then
    v_first := '주말 ' || v_first;
  end if;
  o_label := left(case when cardinality(v_ords) > 1 and v_first is not null and v_last is not null
                       then v_first || '~' || v_last else v_first end, 40);
end;
$$;

-- 휴원일(학원 설정 목록) — 그날은 정규 수업이 없으므로 정규 시간표와의 충돌을 세지 않는다.
create or replace function makeup_private.is_holiday(p_tenant uuid, p_date date) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from jsonb_array_elements(case when jsonb_typeof(makeup_private.operations(p_tenant) -> 'holidays') = 'array'
                                            then makeup_private.operations(p_tenant) -> 'holidays' else '[]'::jsonb end) h
     where h ->> 'date' = to_char(p_date, 'YYYY-MM-DD'))
$$;

revoke all on all functions in schema makeup_private from public, anon, authenticated;
