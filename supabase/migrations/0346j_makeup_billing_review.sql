-- 0346j — 수납 확인 대사(billing_review): 보강 실시가 청구 소비에 닿을 수 있는 경우를 사람에게 알린다
--
-- 세 장부는 따로다: 보강 권리 잔량(이 원장) · 급여 시수/귀속(실제 출결) · 청구 회차 소비(0267a `session_term_attendance`).
-- 🔴 이 파일은 **청구·수납·출결을 읽기만 한다**. 0267a 산식을 다시 정의하지 않고, 청구액·회차·시수를 바꾸지 않는다.
--    (자동 환불·추가 청구·자동 조정 없음 — 산식 변경은 골든마스터를 통과한 별도 결정이다.)
-- 언제 남기는가(참여를 '왔다/일부'로 기록할 때):
--   · 원수업과 실시 날짜의 **청구월이 다를 때**(월 경계) · 한 케이스를 **여러 날짜로 나눠** 실시할 때(분할)
-- 무엇을 적는가(화면이 그대로 보여 준다): 원수업일들 · 실시 날짜 · 그 달 그 반의 quantity_basis · 그 기준의 예상 소비
--   · attendance_units(확정 전이거나 시수 확정) → 예상 소비 = 그 칸에 더해질 보강 시수. **서버가 계산한다**(0345d expected_units:
--     회차 분량에서 — 클라이언트가 보낸 값이 아니다). 자동 시수를 쓰지 않는 지점·과목은 null(사람이 본다).
--   · days(일수로 확정한 호환 행) → 그날 앵커 반의 정규 수업이 있으면 0(날짜 수가 늘지 않는다), 없으면 1
--   · none(그 달 그 반의 청구 회차 행이 없음) · unknown(청구 표를 읽을 수 없음) → 예상 소비 null
-- 이 대사는 종결을 막지 않는다. 해결(확인) 기록은 원장·관리자만 한다(0346h).
-- 멱등: create or replace.

create or replace function makeup_private.billing_basis(p_tenant uuid, p_student uuid, p_class uuid, p_date date)
returns text language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v text;
begin
  if p_class is null or to_regclass('public.invoice_session_terms') is null or to_regclass('public.invoices') is null then
    return 'unknown';
  end if;
  -- 0267a와 같은 판정: 확정 전(confirmed_sessions 없음)은 시수 합, 확정 행은 그 행의 quantity_basis.
  -- 🔴 확정됐는데 기준 칸이 비어 있으면(0267a 이전에 확정한 행의 호환) **일수(days)**다 — none(행 없음)으로 읽지 않는다.
  execute $q$
    select case when st.confirmed_sessions is null then 'attendance_units'
                else coalesce(to_jsonb(st) ->> 'quantity_basis', 'days') end
      from public.invoice_session_terms st
      join public.invoices i on i.id = st.invoice_id and i.tenant_id = st.tenant_id
     where st.tenant_id = $1 and i.student_id = $2 and st.class_id = $3
       and i.period = to_char($4::date, 'YYYY-MM') and i.status::text <> 'void'
     order by (st.confirmed_sessions is null) limit 1 $q$
    into v using p_tenant, p_student, p_class, p_date;
  return coalesce(v, 'none');
exception when others then
  return 'unknown';
end;
$$;

create or replace function makeup_private.note_billing_review(a makeup_private.actor_ctx, p_part uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_p public.makeup_participants%rowtype;
  v_cases uuid[];
  v_month boolean;
  v_split boolean;
  v_basis text;
  v_regular boolean;
  v_units numeric;
begin
  select * into v_p from public.makeup_participants x where x.id = p_part;
  select u.o_makeup into v_units from public.makeup_sessions s,
         lateral makeup_private.expected_units(a.tenant_id, v_p, s.start_time, s.end_time, v_p.status) u
   where s.id = v_p.session_id;
  select array_agg(c.id order by c.id),
         coalesce(bool_or(to_char(c.original_date, 'YYYY-MM') <> to_char(v_p.session_date, 'YYYY-MM')), false),
         coalesce(bool_or((select count(distinct p2.session_date) from public.makeup_allocations a2
                             join public.makeup_participants p2 on p2.id = a2.participant_id and p2.status <> 'cancelled'
                            where a2.case_id = c.id) > 1), false)
    into v_cases, v_month, v_split
    from public.makeup_allocations al join public.makeup_cases c on c.id = al.case_id
   where al.participant_id = p_part;
  if not v_month and not v_split then return; end if;
  v_basis := makeup_private.billing_basis(a.tenant_id, v_p.student_id, v_p.anchor_class_id, v_p.session_date);
  v_regular := v_p.anchor_class_id is not null
    and makeup_private.attends_on(a.tenant_id, v_p.student_id, v_p.anchor_class_id, v_p.session_date)
    and exists (select 1 from makeup_private.regular_slots(a.tenant_id, v_p.session_date) r where r.class_id = v_p.anchor_class_id);
  perform makeup_private.open_recon(a.tenant_id, 'billing_review', 'billing_review:' || p_part::text, false, v_cases[1], p_part,
    v_p.session_id, v_p.attendance_record_id, null,
    jsonb_build_object(
      'quantity_basis', v_basis, 'session_date', v_p.session_date, 'anchor_class_id', v_p.anchor_class_id,
      'original_dates', (select jsonb_agg(c.original_date order by c.original_date) from public.makeup_cases c where c.id = any (v_cases)),
      'month_changed', v_month, 'split', v_split, 'expected_makeup_units', v_units,
      'expected_consumption', case v_basis
        when 'attendance_units' then coalesce(to_jsonb(v_units), 'null'::jsonb)
        when 'days' then to_jsonb(case when v_regular then 0 else 1 end)
        else 'null'::jsonb end,
      'case_ids', to_jsonb(v_cases)));
end;
$$;

revoke all on all functions in schema makeup_private from public, anon, authenticated;
