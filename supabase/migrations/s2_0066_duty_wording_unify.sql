-- s2_0066 — 업무 완성도: 할 일 제목의 낱말을 화면과 같게('기한 초과' · '미이행' → '미처리' · 종류 이름 '출결 입력' → '출결') (2026-11-11)
--
-- 왜: 원장 2026-11-11 *"용어 통일. 어떤곳은 기한 초과, 어떤곳은 미처리"* → *"미처리로 통일"* · *"전체 검토해보고 같은 내용인데 문구 다른곳 전부 통일"*.
--   화면(업무 완성도 · 내 업무)은 '미처리'(기한이 지났는데 끝내지 않은 것 · 닫힌 것은 '미처리 확정') 하나로 맞췄고, 종류 이름도 표 머리와 같은 글자로 줄였다
--   ('출결 입력' → '출결' · '수업보고서 작성' → '보고서 작성' — 앱 `kinds.ts`). 벨의 할 일 제목은 DB가 짓는다 — 세 함수의 글자만 같게 한다.
-- 무엇: ① `duties_private.kind_label` — 두 종류 이름 ② `duty_escalate` — 선생님 몫 할 일 제목 '<종류> 기한 초과 N건' → '<종류> 미처리 N건'
--   ③ `duty_escalate_up` — 과목 관리자 · 원장 몫 제목 '기한 초과 3일 이상' → '미처리 3일 이상' · '기한 초과 7일 이상 · 미이행' → '미처리 7일 이상 · 미처리 확정'.
--   본문은 운영 DB의 지금 정의(pg_get_functiondef) 그대로이고 **작은따옴표 안의 글자만** 다르다(인자 · 반환형 · 권한 · 동작 그대로 — `create or replace`라 실행권도 그대로).
--   늦음 할 일 스위치가 꺼져 있어 지금 열린 할 일은 없다 — 켜면 새 글자로 열린다. 이미 만들어진 할 일의 제목은 바꾸지 않는다.
--   앱과 같은 글자인지는 가드(`live-sync-wiring.test.ts`)가 본다.
-- 되돌리기: s2_0055(kind_label) · s2_0050 뒤 정의(duty_escalate) · s2_0059(duty_escalate_up)의 본문으로.
begin;

CREATE OR REPLACE FUNCTION duties_private.kind_label(p_kind text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case p_kind
    when 'attendance'      then '출결'
    when 'report_write'    then '보고서 작성'
    when 'report_send'     then '보고서 발송'
    when 'video_check'     then '영상 숙제 확인'
    when 'counsel_monthly' then '학생 상담'
    when 'exam_monthly'    then '월말평가'
    when 'newcomer_call'   then '신규생 관리'
    else '업무' end;
$function$
;

CREATE OR REPLACE FUNCTION public.duty_escalate(p_tenant uuid, p_manager_days integer DEFAULT 3, p_owner_days integer DEFAULT 7, p_expire_days integer DEFAULT 7)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_now timestamptz := now();
  v_opened int := 0;
  v_closed int := 0;
  v_task uuid;
  g record;
  v_body text;
  v_title text;
  v_english boolean;
  v_active boolean;
  v_on boolean := false;
  v_live timestamptz := '-infinity';
begin
  select coalesce(s.late_tasks_on, false), coalesce(s.live_from, '-infinity'::timestamptz) into v_on, v_live from public.duty_settings s where s.tenant_id = p_tenant;
  v_on := coalesce(v_on, false); v_live := coalesce(v_live, '-infinity'::timestamptz);

  update public.duty_items set status = 'void', void_reason = 'expired', updated_at = v_now
   where tenant_id = p_tenant and status = 'open' and period in ('daily', 'monthly') and due_at + make_interval(days => p_expire_days) < v_now;

  update public.duty_items set escalation = 1, escalated_at = coalesce(escalated_at, v_now), updated_at = v_now
   where tenant_id = p_tenant and status = 'open' and escalation < 1 and due_at < v_now;
  update public.duty_items set escalation = 2, updated_at = v_now
   where tenant_id = p_tenant and status = 'open' and escalation < 2 and due_at + make_interval(days => p_manager_days) < v_now;
  update public.duty_items set escalation = 3, updated_at = v_now
   where tenant_id = p_tenant and status = 'open' and escalation < 3 and due_at + make_interval(days => p_owner_days) < v_now;

  if v_on then
    for g in
      select d.owner_id, d.kind, d.period, (case when d.period = 'case' then '' else d.cycle end) as grp_cycle,
             count(*) as n, min(d.due_at) as first_due,
             md5(p_tenant::text || ':' || coalesce(d.owner_id::text, 'none') || ':' || d.kind || ':' || (case when d.period = 'case' then '' else d.cycle end))::uuid as subject,
             array_agg(d.id) as ids
        from public.duty_items d
       where d.tenant_id = p_tenant and d.status = 'open' and d.due_at < v_now and d.due_at >= v_live
       group by d.owner_id, d.kind, d.period, (case when d.period = 'case' then '' else d.cycle end)
    loop
      -- 본문: 학생마다 한 줄. 건별은 "이름 — 항목 · 항목", 그 밖은 "이름 · 반".
      select string_agg(line, chr(10) order by line) into v_body from (
        select st.name || case when g.period = 'case'
                                 then ' — ' || string_agg(duties_private.cycle_label(d.kind, d.cycle), ' · ' order by d.due_at)
                                 else coalesce(' · ' || min(c.class_name), '') end as line
          from public.duty_items d join public.students st on st.id = d.student_id left join public.classes c on c.id = d.class_id
         where d.id = any(g.ids)
         group by st.id, st.name
      ) lines;
      select bool_or(d.subject = 'english') into v_english from public.duty_items d where d.id = any(g.ids);
      select exists (select 1 from public.users u where u.id = g.owner_id and u.tenant_id = p_tenant and u.status = 'active') into v_active;
      v_title := duties_private.kind_label(g.kind) || ' 미처리 ' || g.n || '건'
        || case when g.period = 'daily' then ' · ' || to_char(g.grp_cycle::date, 'MM/DD') when g.period = 'monthly' then ' · ' || g.grp_cycle else '' end;
      v_task := staff_tasks_private.open_task(
        p_tenant, 'duty_late', g.subject, '',
        v_title,
        left(coalesce(v_body, ''), 1200),
        case when g.kind in ('attendance', 'report_write', 'report_send', 'video_check') then (case when coalesce(v_english, false) then '/ecs' else '/onescreen' end)
             when g.kind in ('counsel_monthly', 'newcomer_call') then '/consultations/new'
             when g.kind = 'exam_monthly' then '/exams/input' else null end,
        g.first_due + interval '1 day',
        case when g.owner_id is null or not v_active then staff_tasks_private.master_ids(p_tenant) else array[g.owner_id] end,
        null);
      update public.duty_items set task_id = v_task, updated_at = v_now where id = any(g.ids) and task_id is distinct from v_task;
      v_opened := v_opened + 1;
    end loop;
  end if;

  for g in
    select t.id, t.subject_id,
           exists (select 1 from public.duty_items d where d.task_id = t.id and d.status = 'done') as any_done,
           exists (select 1 from public.duty_items d where d.task_id = t.id and d.void_reason = 'expired') as any_expired
      from public.staff_tasks t
     where t.tenant_id = p_tenant and t.kind = 'duty_late' and t.status = 'open'
       and not exists (
         select 1 from public.duty_items d
          where v_on and d.tenant_id = p_tenant and d.status = 'open' and d.due_at < v_now and d.due_at >= v_live
            and md5(p_tenant::text || ':' || coalesce(d.owner_id::text, 'none') || ':' || d.kind || ':' || (case when d.period = 'case' then '' else d.cycle end))::uuid = t.subject_id)
  loop
    v_closed := v_closed + staff_tasks_private.close_task(p_tenant, 'duty_late', g.subject_id, '',
      case when not v_on then 'cancelled' when g.any_done then 'done' when g.any_expired then 'expired' else 'cancelled' end,
      case when not v_on then 'late_tasks_off' when g.any_done then 'duties_resolved' when g.any_expired then 'duties_expired' else 'duties_moved_or_void' end, null);
  end loop;
  return jsonb_build_object('opened', v_opened, 'closed', v_closed);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.duty_escalate_up(p_tenant uuid, p_subjects jsonb, p_manager_days integer DEFAULT 3, p_owner_days integer DEFAULT 7)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
           g.teacher || ' 선생님 — 미처리 3일 이상 ' || g.n || '건', left(coalesce(v_body, ''), 1200), '/duties',
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
           coalesce(nullif(p_subjects -> coalesce(g.subject, '') ->> 'label', ''), case when g.subject is null then '과목 미정' else '기타 과목' end) || ' — 미처리 7일 이상 · 미처리 확정 ' || g.n || '건',
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
$function$
;

commit;
