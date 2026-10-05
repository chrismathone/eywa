-- 0346b — 명령: 자격 승인(approve) · 거절(deny) · 담당 지정(assign)
--
-- 승인·거절은 원장·관리자만 한다(0344a privileged). 승인이 목표 분량과 정책 버전을 케이스에 **고정**한다 —
-- 뒤에 정책이 바뀌어도 이미 승인한 건은 그때의 버전을 그대로 본다(소급 없음).
--   · 승인 분량은 분 단위만. 이미 잡혀 있는 일정(기존 약속)보다 적게는 승인할 수 없다 → 일정을 먼저 조정한다.
--   · 정책 버전을 생략하면 지금 유효한 버전을 쓴다. 한 번도 만든 적이 없으면 **승인자 명의**로 기본 버전
--     (분 단위 · 자동 승인/자동 소멸 없음 · 자기 검토 없음)을 만들고 이벤트를 남긴다.
--   · 거절은 살아 있는 일정이 있으면 거절한다 — 약속을 숨기거나 자동 취소하지 않는다.
-- 담당 지정은 지점 전체 운영 권한이 한다(인계). 이전 담당자는 이벤트에 남는다.
-- 멱등: create or replace.

create or replace function makeup_private.current_policy(a makeup_private.actor_ctx, p_cmd uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  select pv.id into v_id from public.makeup_policy_versions pv
   where pv.tenant_id = a.tenant_id and pv.effective_from <= a.today
   order by pv.effective_from desc, pv.created_at desc limit 1;
  if v_id is null then
    insert into public.makeup_policy_versions (tenant_id, label, effective_from, approved_by, note, created_at)
      values (a.tenant_id, '기본 정책', a.today, a.user_id, '첫 승인 때 만든 기본 정책 — 건별 사람 승인, 자동 처리 없음', clock_timestamp())
      returning id into v_id;
    perform makeup_private.log_event(a.tenant_id, 'policy', v_id, 'policy_created', a.user_id, p_cmd, null, null,
      null, jsonb_build_object('default', true));
  end if;
  return v_id;
end;
$$;

create or replace function makeup_private.cmd_approve(a makeup_private.actor_ctx, p_cmd uuid, p jsonb, p_rev integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid := makeup_private.p_uuid(p, 'case_id');
  v_target integer := makeup_private.p_int(p, 'target_minutes');
  v_policy uuid := makeup_private.p_uuid(p, 'policy_version_id');
  v_owner uuid := makeup_private.p_uuid(p, 'owner_id');
  v_case public.makeup_cases%rowtype;
  v_reasons text[];
  v_from integer;
begin
  perform makeup_private.require_level(a, 'privileged');
  perform makeup_private.lock_cases(a.tenant_id, array[v_id]);
  select * into v_case from public.makeup_cases c where c.id = v_id;
  perform makeup_private.check_revision(p_rev, v_case.revision);
  if v_case.lifecycle = 'closed' or v_case.eligibility <> 'pending' then
    perform makeup_private.fail('conflict', '이미 판정한 보강 건입니다');
  end if;
  if p ? 'unit_kind' and p ->> 'unit_kind' is distinct from 'minutes' then
    perform makeup_private.fail('invalid', '보강 분량은 분 단위로만 승인합니다');
  end if;
  if v_target is null or v_target not between 1 and 6000 then
    perform makeup_private.fail('invalid', '승인할 분량을 분 단위로 넣어 주세요');
  end if;
  if v_target < v_case.committed_minutes then
    perform makeup_private.fail('live_commitments', '이미 잡힌 일정보다 적게 승인할 수 없습니다 — 일정을 조정한 뒤 다시 승인해 주세요',
      jsonb_build_object('commitments', makeup_private.live_commitments(v_id)));
  end if;
  if v_policy is null then
    v_policy := makeup_private.current_policy(a, p_cmd);
  end if;
  select pv.allowed_reasons into v_reasons from public.makeup_policy_versions pv
   where pv.id = v_policy and pv.tenant_id = a.tenant_id;
  if not found then perform makeup_private.fail('not_found', '정책 버전을 찾을 수 없습니다'); end if;
  if cardinality(v_reasons) > 0 and not (v_case.reason = any (v_reasons)) then
    perform makeup_private.fail('invalid', '이 정책에서 승인할 수 없는 사유입니다 — 정책을 확인해 주세요');
  end if;
  perform makeup_private.assert_staff(a.tenant_id, v_owner);
  v_from := v_case.revision;
  update public.makeup_cases c
     set eligibility = 'approved', target_minutes = v_target, policy_version_id = v_policy,
         owner_id = coalesce(v_owner, c.owner_id), due_date = coalesce(makeup_private.p_date(p, 'due_date'), c.due_date)
   where c.id = v_id returning * into v_case;
  -- 승인 근거(note·reason)는 이벤트에 남긴다 — 접수 때 적은 메모를 덮어쓰지 않는다.
  perform makeup_private.log_event(a.tenant_id, 'case', v_id, 'approved', a.user_id, p_cmd, v_id, null,
    coalesce(makeup_private.p_text(p, 'reason'), makeup_private.p_text(p, 'note')),
    jsonb_build_object('target_minutes', v_target, 'policy_version_id', v_policy, 'owner_id', v_case.owner_id,
      'due_date', v_case.due_date), v_from, v_case.revision);
  perform makeup_private.audit(a, 'approve', '보강 승인', jsonb_build_object('command_id', p_cmd, 'case_id', v_id, 'minutes', v_target));
  return makeup_private.result('approve', v_id, v_case.revision, 'approve:' || v_id::text, array[v_id]);
end;
$$;

create or replace function makeup_private.cmd_deny(a makeup_private.actor_ctx, p_cmd uuid, p jsonb, p_rev integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid := makeup_private.p_uuid(p, 'case_id');
  v_reason text := makeup_private.p_text(p, 'reason');
  v_case public.makeup_cases%rowtype;
  v_from integer;
begin
  perform makeup_private.require_level(a, 'privileged');
  perform makeup_private.lock_cases(a.tenant_id, array[v_id]);
  select * into v_case from public.makeup_cases c where c.id = v_id;
  perform makeup_private.check_revision(p_rev, v_case.revision);
  if v_case.lifecycle = 'closed' or v_case.eligibility <> 'pending' then
    perform makeup_private.fail('conflict', '이미 판정한 보강 건입니다');
  end if;
  if v_reason is null then perform makeup_private.fail('invalid', '거절 사유를 적어 주세요'); end if;
  -- 기존 약속이 살아 있으면 자격 거절만 저장하지 않는다(일정을 숨기거나 자동 취소하지 않는다).
  perform makeup_private.assert_closable(a.tenant_id, v_id);
  v_from := v_case.revision;
  update public.makeup_cases c
     set eligibility = 'denied', lifecycle = 'closed', closure_reason = 'denied', closed_at = now()
   where c.id = v_id returning * into v_case;
  perform makeup_private.log_event(a.tenant_id, 'case', v_id, 'denied', a.user_id, p_cmd, v_id, null, v_reason,
    '{}'::jsonb, v_from, v_case.revision);
  perform makeup_private.audit(a, 'deny', '보강 거절', jsonb_build_object('command_id', p_cmd, 'case_id', v_id));
  return makeup_private.result('deny', v_id, v_case.revision, 'deny:' || v_id::text, array[v_id]);
end;
$$;

create or replace function makeup_private.cmd_assign(a makeup_private.actor_ctx, p_cmd uuid, p jsonb, p_rev integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid := makeup_private.p_uuid(p, 'case_id');
  v_owner uuid := makeup_private.p_uuid(p, 'owner_id');
  v_case public.makeup_cases%rowtype;
  v_prev uuid;
  v_from integer;
begin
  perform makeup_private.require_level(a, 'wide');
  perform makeup_private.lock_cases(a.tenant_id, array[v_id]);
  select * into v_case from public.makeup_cases c where c.id = v_id;
  perform makeup_private.check_revision(p_rev, v_case.revision);
  if v_case.lifecycle = 'closed' then
    perform makeup_private.fail('conflict', '종결한 보강 건은 담당을 바꿀 수 없습니다');
  end if;
  perform makeup_private.assert_staff(a.tenant_id, v_owner);
  v_prev := v_case.owner_id;
  v_from := v_case.revision;
  -- 승인된 건의 기한을 바꾸는 것은 승인 권한의 결정이다(조용히 무시하지 않고 거절한다). 바꾸면 결정 기록을 남긴다.
  if p ? 'due_date' and makeup_private.p_date(p, 'due_date') is distinct from v_case.due_date and v_case.eligibility = 'approved' then
    perform makeup_private.require_level(a, 'privileged');
    insert into public.makeup_adjustments (tenant_id, case_id, kind, due_date_from, due_date_to, reason, policy_version_id, decided_by, effect_key)
      values (a.tenant_id, v_id, 'due_date', v_case.due_date, makeup_private.p_date(p, 'due_date'),
        coalesce(makeup_private.p_text(p, 'reason'), '담당·기한 지정'), v_case.policy_version_id, a.user_id, 'due:' || p_cmd::text);
  end if;
  update public.makeup_cases c
     set owner_id = case when p ? 'owner_id' then v_owner else c.owner_id end,
         due_date = case when p ? 'due_date' then makeup_private.p_date(p, 'due_date') else c.due_date end,
         note = case when p ? 'note' then left(makeup_private.p_text(p, 'note'), 1000) else c.note end
   where c.id = v_id returning * into v_case;
  -- 담당자가 다시 정해졌으면 담당 부재 대사 항목은 해소된 것이다.
  if v_case.owner_id is not null and v_case.owner_id is distinct from v_prev then
    update public.makeup_reconciliation r
       set state = 'resolved', resolved_at = now(), resolved_by = a.user_id, resolution_note = '담당자를 다시 지정했습니다'
     where r.tenant_id = a.tenant_id and r.case_id = v_id and r.kind = 'owner_inactive' and r.state = 'open';
    -- 인계 사유(담당자가 그 반·학생을 더는 맡지 않음 등)도 새 담당 기준으로 다시 본다(0349d).
    perform makeup_private.scan_handover(a.tenant_id, v_case.student_id, null);
  end if;
  perform makeup_private.log_event(a.tenant_id, 'case', v_id, 'assigned', a.user_id, p_cmd, v_id, null,
    makeup_private.p_text(p, 'reason'),
    jsonb_build_object('owner_id', v_case.owner_id, 'previous_owner_id', v_prev, 'due_date', v_case.due_date),
    v_from, v_case.revision);
  return makeup_private.result('assign', v_id, v_case.revision, 'assign:' || p_cmd::text, array[v_id]);
end;
$$;

revoke all on all functions in schema makeup_private from public, anon, authenticated;
