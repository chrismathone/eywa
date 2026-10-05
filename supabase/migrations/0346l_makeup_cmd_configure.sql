-- 0346l — 명령: 설정(configure) — 운영 모드 · 정책 버전. 원장만.
--
-- 🔴 첫 운영 범위는 서버가 강제한다(화면이 숨겼는지와 무관하게 요청을 거절한다):
--   · 대상 과목(pilot_subjects)은 정확히 ["math"] 하나 — 영어 등 다른 과목이 섞이면 거절.
--   · 추가 지도(allow_additional = true) 거절 — 결석 보강만 운영한다.
--   · 정책의 자기 검토(policy.self_verify = true) 거절 · 추가 지도 수납 기준(additional_billing)은 undecided만.
--     (0343a의 CHECK가 같은 범위를 표에서도 잠근다 — 명령을 거치지 않은 쓰기도 통과하지 못한다.)
--   저장하는 값도 항상 allowAdditional = false · pilotSubjects = ["math"]로 맞춘다(옛 값이 남지 않게).
-- 운영 모드:
--   · off 전환은 열린 보강 건 · 열린 대사 · 미처리 반영 작업이 0건일 때만(먼저 draining으로 마무리한다).
--     꺼진 뒤에도 연결된 기존 예약의 보호(0349a)는 그대로다 — 연결을 없던 일로 만들지 않는다.
--   · on · draining으로 저장하면 기능 목록(`modules.disabled`)에서 보강관리를 **뺀다** — 열린 업무가 있는데 메뉴가 꺼져
--     아무도 못 보는 상태를 만들지 않는다(직접 넣는 쪽은 0344b 가드가 거절한다).
--   · 설정 잠금: 모든 명령은 공유 잠금, configure는 배타 잠금(0347a) — 끄는 순간 새 접수가 끼어들지 못한다.
-- 멱등: create or replace.

create or replace function makeup_private.cmd_configure(a makeup_private.actor_ctx, p_cmd uuid, p jsonb, p_rev integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_subjects jsonb := p -> 'pilot_subjects';
  v_policy jsonb := p -> 'policy';
  v_policy_id uuid;
  v_open jsonb;
  v_rev integer;
begin
  perform makeup_private.require_level(a, 'configure');
  insert into public.tenant_settings (tenant_id, data) values (a.tenant_id, '{}'::jsonb) on conflict (tenant_id) do nothing;
  select makeup_private.normalize_settings(ts.data -> 'makeups') into v_old
    from public.tenant_settings ts where ts.tenant_id = a.tenant_id for update;
  select count(*)::integer into v_rev from public.makeup_events e
   where e.tenant_id = a.tenant_id and e.entity_type = 'settings';
  perform makeup_private.check_revision(p_rev, v_rev, false);
  if (p ? 'mode' and coalesce(p ->> 'mode', '') not in ('off', 'on', 'draining'))
     or (p ? 'allow_additional' and jsonb_typeof(p -> 'allow_additional') <> 'boolean')
     or (p ? 'pilot_subjects' and jsonb_typeof(v_subjects) <> 'array') then
    perform makeup_private.fail('invalid', '보강관리 설정값이 올바르지 않습니다 — 운영 상태와 대상 과목을 확인해 주세요');
  end if;
  if p ? 'pilot_subjects' and v_subjects <> '["math"]'::jsonb then
    perform makeup_private.fail('invalid', '지금은 수학만 대상으로 운영할 수 있습니다 — 대상 과목을 확인해 주세요',
      jsonb_build_object('field', 'pilot_subjects'));
  end if;
  if (p -> 'allow_additional') = 'true'::jsonb then
    perform makeup_private.fail('invalid', '추가 지도는 아직 운영하지 않습니다 — 결석 보강만 켤 수 있습니다',
      jsonb_build_object('field', 'allow_additional'));
  end if;
  if jsonb_typeof(v_policy) = 'object' then
    if makeup_private.p_text(v_policy, 'label') is null then
      perform makeup_private.fail('invalid', '정책 이름을 적어 주세요');
    end if;
    if (v_policy -> 'self_verify') = 'true'::jsonb then
      perform makeup_private.fail('invalid', '실시한 강사가 스스로 검토하는 것은 아직 허용하지 않습니다',
        jsonb_build_object('field', 'policy.self_verify'));
    end if;
    if v_policy ? 'additional_billing' and coalesce(v_policy ->> 'additional_billing', '') <> 'undecided' then
      perform makeup_private.fail('invalid', '추가 지도의 수납 기준은 아직 정할 수 없습니다',
        jsonb_build_object('field', 'policy.additional_billing'));
    end if;
  elsif p ? 'policy' and v_policy <> 'null'::jsonb then
    perform makeup_private.fail('invalid', '정책 내용을 확인해 주세요');
  end if;

  v_new := jsonb_build_object('mode', coalesce(p ->> 'mode', v_old ->> 'mode'),
    'allowAdditional', false, 'pilotSubjects', '["math"]'::jsonb);
  if v_new ->> 'mode' = 'off' and v_old ->> 'mode' <> 'off' then
    v_open := jsonb_build_object(
      'cases', (select count(*) from public.makeup_cases c where c.tenant_id = a.tenant_id and c.lifecycle <> 'closed'),
      'reconciliation', (select count(*) from public.makeup_reconciliation r where r.tenant_id = a.tenant_id and r.state = 'open'),
      'projections', (select count(*) from public.makeup_projection_jobs j
                       where j.tenant_id = a.tenant_id and j.state in ('pending', 'failed')));
    if (v_open ->> 'cases')::integer + (v_open ->> 'reconciliation')::integer + (v_open ->> 'projections')::integer > 0 then
      perform makeup_private.fail('conflict', '진행 중인 보강 건이나 확인 필요 항목이 남아 있어 끌 수 없습니다 — 정리 상태로 바꿔 마무리한 뒤 꺼 주세요', v_open);
    end if;
  end if;
  update public.tenant_settings ts
     set data = jsonb_set(ts.data, '{makeups}', v_new), updated_by = a.user_id, updated_at = now()
   where ts.tenant_id = a.tenant_id;
  -- 쓰는 중에는 기능 목록에서 꺼져 있지 않게 한다(열린 업무가 메뉴째 숨는 것을 막는다).
  if v_new ->> 'mode' <> 'off' then
    update public.tenant_settings ts
       set data = jsonb_set(ts.data, '{modules,disabled}', coalesce((
             select jsonb_agg(x) from jsonb_array_elements(ts.data #> '{modules,disabled}') x where x <> '"makeups"'::jsonb), '[]'::jsonb))
     where ts.tenant_id = a.tenant_id and jsonb_typeof(ts.data #> '{modules,disabled}') = 'array'
       and ts.data #> '{modules,disabled}' @> '["makeups"]'::jsonb;
  end if;
  if jsonb_typeof(v_policy) = 'object' then
    -- created_at은 실제 시계(같은 효력일의 버전 중 나중에 만든 것이 현재 버전이다).
    insert into public.makeup_policy_versions (tenant_id, label, effective_from, allowed_reasons, self_verify,
        additional_billing, note, approved_by, created_at)
      values (a.tenant_id, left(makeup_private.p_text(v_policy, 'label'), 80),
        coalesce(makeup_private.p_date(v_policy, 'effective_from'), a.today),
        coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(v_policy -> 'allowed_reasons') = 'array'
                                                             then v_policy -> 'allowed_reasons' else '[]'::jsonb end)), '{}'),
        false, 'undecided', left(makeup_private.p_text(v_policy, 'note'), 500), a.user_id, clock_timestamp())
      returning id into v_policy_id;
    perform makeup_private.log_event(a.tenant_id, 'policy', v_policy_id, 'policy_created', a.user_id, p_cmd, null, null,
      makeup_private.p_text(p, 'reason'), v_policy);
  end if;
  perform makeup_private.log_event(a.tenant_id, 'settings', a.tenant_id, 'configured', a.user_id, p_cmd, null, null,
    makeup_private.p_text(p, 'reason'), jsonb_build_object('from', v_old, 'to', v_new), v_rev, v_rev + 1);
  perform makeup_private.audit(a, 'configure', '보강관리 설정 변경', jsonb_build_object('command_id', p_cmd, 'from', v_old, 'to', v_new));
  return makeup_private.result('configure', a.tenant_id, v_rev + 1, 'cfg:' || p_cmd::text, '{}'::uuid[],
    jsonb_build_object('settings', v_new, 'policy_version_id', v_policy_id));
end;
$$;

revoke all on all functions in schema makeup_private from public, anon, authenticated;
