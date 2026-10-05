-- 0346h — 명령: 보류(hold) · 재개(resume) · 종결(close)
--
--   · 보류는 종결이 아니다 — 잔량과 잡힌 일정을 그대로 두고 새 일정만 멈춘다. 재검토일이 있어야 한다
--     (휴원 등으로 건이 영영 숨지 않게).
--   · 종결은 살아 있는 약속 · 미처리 반영 작업 · 종결을 막는 열린 대사가 **하나도 없을 때만** 된다.
--     남은 의무가 있는 채로 닫을 수 있는 사유는 둘뿐이다: 중복(duplicate — 대표 건으로 근거를 옮긴다) ·
--     원사건 철회(source_retracted). 그 밖에는 남은 분량을 실시하거나 면제해 0으로 만든 뒤 닫힌다.
--   · 한 참여가 여러 케이스에 걸려 있으면 그 참여의 미결 시수 대사는 연결된 케이스 **전부**의 종결을 막는다.
-- 멱등: create or replace.

create or replace function makeup_private.cmd_hold(a makeup_private.actor_ctx, p_cmd uuid, p jsonb, p_rev integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid := makeup_private.p_uuid(p, 'case_id');
  v_resume boolean := p ->> '_resume' = 'true';
  v_reason text := makeup_private.p_text(p, 'reason');
  v_review date := makeup_private.p_date(p, 'hold_review_at');
  v_c public.makeup_cases%rowtype;
  v_from integer;
begin
  perform makeup_private.require_level(a, 'wide');
  perform makeup_private.lock_cases(a.tenant_id, array[v_id]);
  select * into v_c from public.makeup_cases c where c.id = v_id;
  perform makeup_private.check_revision(p_rev, v_c.revision);
  v_from := v_c.revision;
  if v_resume then
    if v_c.lifecycle <> 'on_hold' then perform makeup_private.fail('conflict', '보류 중인 보강 건이 아닙니다'); end if;
    perform makeup_private.assert_staff(a.tenant_id, makeup_private.p_uuid(p, 'owner_id'));
    update public.makeup_cases c
       set lifecycle = 'open', hold_reason = null, hold_review_at = null,
           owner_id = coalesce(makeup_private.p_uuid(p, 'owner_id'), c.owner_id)
     where c.id = v_id returning * into v_c;
  else
    if v_c.lifecycle <> 'open' then perform makeup_private.fail('conflict', '진행 중인 보강 건만 보류할 수 있습니다'); end if;
    if v_reason is null or v_review is null or v_review < a.today then
      perform makeup_private.fail('invalid', '보류 사유와 다시 검토할 날짜를 넣어 주세요');
    end if;
    update public.makeup_cases c set lifecycle = 'on_hold', hold_reason = left(v_reason, 500), hold_review_at = v_review
     where c.id = v_id returning * into v_c;
  end if;
  perform makeup_private.log_event(a.tenant_id, 'case', v_id, case when v_resume then 'resumed' else 'held' end,
    a.user_id, p_cmd, v_id, null, v_reason, jsonb_build_object('hold_review_at', v_review), v_from, v_c.revision);
  return makeup_private.result(case when v_resume then 'resume' else 'hold' end, v_id, v_c.revision,
    'hold:' || p_cmd::text, array[v_id]);
end;
$$;

create or replace function makeup_private.cmd_close(a makeup_private.actor_ctx, p_cmd uuid, p jsonb, p_rev integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid := makeup_private.p_uuid(p, 'case_id');
  v_why text := makeup_private.p_text(p, 'closure_reason');
  v_reason text := makeup_private.p_text(p, 'reason');
  v_into uuid := makeup_private.p_uuid(p, 'merged_into');
  v_c public.makeup_cases%rowtype;
  v_from integer;
begin
  perform makeup_private.require_level(a, 'privileged');
  perform makeup_private.lock_cases(a.tenant_id, array(select x from unnest(array[v_id, v_into]) x where x is not null));
  select * into v_c from public.makeup_cases c where c.id = v_id;
  perform makeup_private.check_revision(p_rev, v_c.revision);
  if v_c.lifecycle = 'closed' then perform makeup_private.fail('conflict', '이미 종결한 보강 건입니다'); end if;
  if v_why is null or v_why not in ('completed', 'completed_with_waiver', 'waived', 'duplicate', 'source_retracted') or v_reason is null then
    perform makeup_private.fail('invalid', '종결 사유를 고르고 내용을 적어 주세요');
  end if;
  perform makeup_private.assert_closable(a.tenant_id, v_id);
  if v_why = 'duplicate' then
    if v_into is null or v_into = v_id or not exists (
         select 1 from public.makeup_cases t where t.id = v_into and t.student_id = v_c.student_id
            and t.subject_key = v_c.subject_key and t.lifecycle <> 'closed') then
      perform makeup_private.fail('invalid', '같은 학생·같은 과목의 진행 중인 대표 건을 골라 주세요');
    end if;
    -- 근거를 대표 건으로 모은다(옛 건의 번호와 이력은 그대로 남는다).
    update public.makeup_case_sources s set case_id = v_into where s.case_id = v_id;
  elsif v_why <> 'source_retracted' then
    if coalesce(v_c.outstanding_minutes, 1) <> 0
       or v_why <> (case when v_c.recognized_minutes = 0 then 'waived'
                         when v_c.waived_minutes > 0 then 'completed_with_waiver' else 'completed' end) then
      perform makeup_private.fail('conflict', '남은 분량이 있거나 종결 사유가 기록과 맞지 않습니다 — 일정을 잡거나 면제한 뒤 종결해 주세요',
        jsonb_build_object('outstanding', v_c.outstanding_minutes, 'recognized', v_c.recognized_minutes, 'waived', v_c.waived_minutes));
    end if;
  end if;
  v_from := v_c.revision;
  update public.makeup_cases c
     set lifecycle = 'closed', closure_reason = v_why, closed_at = now(),
         merged_into = case when v_why = 'duplicate' then v_into end
   where c.id = v_id returning * into v_c;
  perform makeup_private.log_event(a.tenant_id, 'case', v_id, 'closed', a.user_id, p_cmd, v_id, null, v_reason,
    jsonb_build_object('closure_reason', v_why, 'merged_into', v_c.merged_into, 'outstanding', v_c.outstanding_minutes,
      'recognized_minutes', v_c.recognized_minutes, 'waived_minutes', v_c.waived_minutes), v_from, v_c.revision);
  perform makeup_private.audit(a, 'close', '보강 종결', jsonb_build_object('command_id', p_cmd, 'case_id', v_id, 'reason', v_why));
  return makeup_private.result('close', v_id, v_c.revision, 'close:' || v_id::text, array[v_id]);
end;
$$;

revoke all on all functions in schema makeup_private from public, anon, authenticated;
