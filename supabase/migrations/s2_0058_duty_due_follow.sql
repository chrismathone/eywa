-- s2_0058 — 업무 완성도: 기한이 바뀌면 장부의 기한도 따라간다 (2026-11-11)
--
-- 왜: 원장 2026-11-11 *"출결을 수업시간보다 늦게했다거나 보고서를 수업종료 후 24시간 이내에 발송하지 않으면 지연된 업무로 판단하고 패널티"* —
--   기한을 '출결 당일 자정 · 발송 다음 날 정오'에서 **출결 = 그 반 수업이 끝나는 시각 · 보고서 발송 = 수업이 끝난 뒤 24시간**으로 바꿨다(앱 `model/daily.ts`).
--   그런데 `duty_upsert_items`(s2_0043)는 이미 있는 행의 기한을 고치지 않아, 다시 맞춰도 옛 기한(자정 · 정오)이 남았다.
-- 무엇: `duty_upsert_items` — 같은 열쇠의 행이 있고 기한이 다르면 기한을 맞춘다(상태 불문 — 끝난 의무도 새 기한으로 제때/지연이 다시 가려진다).
--   그 밖은 s2_0043 본문 그대로. 이미 미이행으로 확정된 것은 확정 그대로다.
-- 되돌리기: s2_0043의 duty_upsert_items 본문으로.
begin;

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
  ), due as (
    -- 기한이 달라졌으면 맞춘다(열린 것 · 끝난 것 · 미이행 확정 모두) — 기한 규칙이 바뀌면 제때/지연이 새 기한으로 다시 가려진다.
    update public.duty_items d set due_at = s.due_at, updated_at = now()
      from src s
     where d.tenant_id = p_tenant and d.kind = s.kind and d.subject_key = s.subject_key and d.cycle = s.cycle
       and d.due_at is distinct from s.due_at
    returning 1
  )
  select (select count(*) filter (where inserted) from ins), (select count(*) filter (where not inserted) from ins) + (select count(*) from due) into v_inserted, v_updated;
  return jsonb_build_object('inserted', v_inserted, 'updated', v_updated);
end;
$fn$;

commit;
