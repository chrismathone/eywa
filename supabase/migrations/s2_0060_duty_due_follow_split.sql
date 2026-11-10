-- s2_0060 — 업무 완성도: 기한 맞춤을 따로 떼어 낸다 (2026-11-11 · 적대적 리뷰)
--
-- 왜: s2_0058은 한 문장 안에서 `ins`(열기 · 담당/반 고침)와 `due`(기한 고침)가 같은 행을 건드렸다. 같은 문장이 이미 고친 행은 뒤의 고침이 조용히 빠져,
--   담당 · 반이 바뀐 행(신규생 관리에 반을 채운 첫 맞춤 등)의 기한은 다음 맞춤에서야 바뀌었다.
-- 무엇: `duty_upsert_items` — 기한 맞춤을 별도 문장으로. 그 밖은 s2_0058 본문 그대로.
-- 되돌리기: s2_0058의 duty_upsert_items 본문으로.
begin;

create or replace function public.duty_upsert_items(p_tenant uuid, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = public
as $fn$
declare
  v_inserted int := 0;
  v_updated int := 0;
  v_due int := 0;
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
  )
  select count(*) filter (where inserted), count(*) filter (where not inserted) into v_inserted, v_updated from ins;
  -- 기한이 달라졌으면 맞춘다(열린 것 · 끝난 것 · 미이행 확정 모두). 🔴 위 문장과 **따로** 돈다 — 한 문장 안에서 같은 행을 두 번 고치면 뒤의 것이 조용히 빠진다.
  update public.duty_items d set due_at = x."dueAt", updated_at = now()
    from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as x(kind text, cycle text, "subjectKey" text, "dueAt" timestamptz)
   where d.tenant_id = p_tenant and d.kind = x.kind and d.subject_key = x."subjectKey" and d.cycle = x.cycle
     and x."dueAt" is not null and d.due_at is distinct from x."dueAt";
  get diagnostics v_due = row_count;
  v_updated := v_updated + v_due;
  return jsonb_build_object('inserted', v_inserted, 'updated', v_updated);
end;
$fn$;

commit;
