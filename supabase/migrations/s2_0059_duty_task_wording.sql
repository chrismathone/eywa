-- s2_0059 — 업무 완성도: 윗단계 할 일 제목의 낱말을 화면과 같게('지연' → '기한 초과') (2026-11-11)
--
-- 왜: 원장 2026-11-11 *"지연과 기한 초과가 다른말인가? 같은 말이면 기한 초과로 통일"* — 화면은 '기한 초과'로 통일했다. 과목 관리자 · 원장에게 가는
--   할 일(`duty_escalate_up`)의 제목만 '3일 이상 지연 N건'이었다. 선생님 몫 할 일(`duty_escalate`)의 제목은 원래 '기한 초과'다.
-- 무엇: `duty_escalate_up` — 제목 두 곳의 낱말만. 그 밖은 s2_0052 본문 그대로(늦음 할 일 스위치가 꺼져 있어 지금 열린 할 일은 없다).
-- 되돌리기: s2_0052의 duty_escalate_up 본문으로.
begin;

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
           g.teacher || ' 선생님 — 기한 초과 3일 이상 ' || g.n || '건', left(coalesce(v_body, ''), 1200), '/duties',
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
           coalesce(nullif(p_subjects -> coalesce(g.subject, '') ->> 'label', ''), case when g.subject is null then '과목 미정' else '기타 과목' end) || ' — 기한 초과 7일 이상 · 미이행 ' || g.n || '건',
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

commit;
