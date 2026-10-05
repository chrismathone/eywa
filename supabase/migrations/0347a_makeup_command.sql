-- 0347a — 진입점: public.makeup_command (보강 원장의 유일한 쓰기 경로)
--
-- makeup_command(p_command_id uuid, p_action text, p_payload jsonb, p_expected_revision integer default null) → jsonb
--   action: intake · approve · deny · assign · reserve · reschedule · cancel · participation · submit · verify · reverse ·
--           waive · adjust · hold · resume · close · link_legacy · resolve_reconciliation · configure · reconcile(대사 실행 0349e)
--   성공 = {id, revision, replayed, effect_key, action, case_id, case_ids[], session_id, participant_id, fulfillment_id,
--          quantities{target,adjusted,recognized,waived,outstanding,committed,reservable}|null, warnings[], …}
--   실패 = 예외(트랜잭션 전체 롤백 — 반쪽 저장이 남지 않는다). message = 화면용 한글, detail = {"code": …} JSON.
--     code: forbidden · mode_off · mode_draining · invalid · not_found · conflict · live_commitments ·
--           evidence_required(실시 증거 없이 참여를 기록하려 함 — 0346e) ·
--           stale_revision(다른 사람이 먼저 바꿈 — 409 성격) · command_conflict(같은 요청 번호를 다른 내용/사람이 재사용)
-- 🔴 행위자는 auth.uid()뿐이다 — 반드시 **사용자 세션 클라이언트**로 부른다. 관리자 클라이언트(service_role)는
--    실행 권한이 없고, 있더라도 행위자가 없어 거절된다(행위자를 인자로 넘기는 길이 없다).
-- 멱등: (학원, command_id)는 한 번만 실행된다. 같은 사람이 같은 내용으로 다시 보내면 저장해 둔 결과를 돌려준다
--   (replayed = true — 이때도 **지금 권한**으로 결과가 닿은 케이스의 범위를 다시 본다). 실제 반영의 중복은
--   요청 번호와 별개인 안정 효과 키(effect_key 유니크)가 막는다.
-- 잠금: 설정 잠금(명령 = 공유 · configure = 배타) → 요청 번호 잠금 → 각 명령의 자원/케이스/행 잠금(0345a 순서).
-- 멱등 적용: create or replace.

create or replace function public.makeup_command(
  p_command_id uuid, p_action text, p_payload jsonb, p_expected_revision integer default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  a makeup_private.actor_ctx;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_hash text;
  v_prev public.makeup_commands%rowtype;
  v_res jsonb;
  v_cfg_key bigint;
begin
  a := makeup_private.actor();
  if p_command_id is null or p_action is null or jsonb_typeof(v_payload) <> 'object' then
    perform makeup_private.fail('invalid', '요청 형식이 올바르지 않습니다 — 새로 고친 뒤 다시 시도해 주세요');
  end if;
  -- 설정 잠금을 잡은 뒤 운영 모드를 다시 읽는다(끄는 순간 끼어드는 접수를 막는다).
  v_cfg_key := hashtextextended('makeup:' || a.tenant_id::text || ':cfg', 0);
  if p_action = 'configure' then
    perform pg_advisory_xact_lock(v_cfg_key);
  else
    perform pg_advisory_xact_lock_shared(v_cfg_key);
  end if;
  a := makeup_private.actor();
  perform makeup_private.lock_keys(a.tenant_id, array['cmd:' || p_command_id::text]);

  v_hash := md5(p_action || ':' || coalesce(p_expected_revision::text, '') || ':' || v_payload::text);
  select * into v_prev from public.makeup_commands c where c.tenant_id = a.tenant_id and c.command_id = p_command_id;
  if found then
    -- 같은 요청 번호: 같은 사람·같은 내용만 저장된 결과를 다시 받는다. 다르면 결과를 보여 주지 않고 거절.
    if v_prev.actor_id is distinct from a.user_id or v_prev.action <> p_action or v_prev.payload_hash <> v_hash then
      perform makeup_private.fail('command_conflict', '같은 요청이 다른 내용으로 이미 처리되었습니다 — 새로 고친 뒤 다시 시도해 주세요');
    end if;
    perform makeup_private.require_mode(a, p_action);
    if a.access = 'readonly' or (p_action = 'configure' and not a.can_configure)
       or exists (select 1 from unnest(v_prev.case_ids) c where not makeup_private.in_scope(a, c)) then
      perform makeup_private.fail('forbidden', '이 작업의 결과를 볼 권한이 없습니다');
    end if;
    return v_prev.result || jsonb_build_object('replayed', true);
  end if;

  perform makeup_private.require_mode(a, p_action);
  -- 여기서부터 끝까지만 "명령 안"이다 — 같은 트랜잭션의 뒤따르는 문장이 원장을 직접 쓰지 못하게 끝에서 표시를 지운다.
  perform makeup_private.enter();
  v_res := case p_action
    when 'intake' then makeup_private.cmd_intake(a, p_command_id, v_payload, p_expected_revision)
    when 'approve' then makeup_private.cmd_approve(a, p_command_id, v_payload, p_expected_revision)
    when 'deny' then makeup_private.cmd_deny(a, p_command_id, v_payload, p_expected_revision)
    when 'assign' then makeup_private.cmd_assign(a, p_command_id, v_payload, p_expected_revision)
    when 'reserve' then makeup_private.cmd_reserve(a, p_command_id, v_payload, p_expected_revision)
    when 'reschedule' then makeup_private.cmd_reschedule(a, p_command_id, v_payload, p_expected_revision)
    when 'cancel' then makeup_private.cmd_cancel(a, p_command_id, v_payload, p_expected_revision)
    when 'participation' then makeup_private.cmd_participation(a, p_command_id, v_payload, p_expected_revision)
    when 'submit' then makeup_private.cmd_submit(a, p_command_id, v_payload, p_expected_revision)
    when 'verify' then makeup_private.cmd_verify(a, p_command_id, v_payload, p_expected_revision)
    when 'reverse' then makeup_private.cmd_reverse(a, p_command_id, v_payload, p_expected_revision)
    when 'waive' then makeup_private.cmd_waive(a, p_command_id, v_payload, p_expected_revision)
    when 'adjust' then makeup_private.cmd_adjust(a, p_command_id, v_payload, p_expected_revision)
    when 'hold' then makeup_private.cmd_hold(a, p_command_id, v_payload - '_resume', p_expected_revision)
    when 'resume' then makeup_private.cmd_hold(a, p_command_id, v_payload || '{"_resume": true}'::jsonb, p_expected_revision)
    when 'close' then makeup_private.cmd_close(a, p_command_id, v_payload, p_expected_revision)
    when 'link_legacy' then makeup_private.cmd_link_legacy(a, p_command_id, v_payload, p_expected_revision)
    when 'resolve_reconciliation' then makeup_private.cmd_resolve(a, p_command_id, v_payload, p_expected_revision)
    when 'configure' then makeup_private.cmd_configure(a, p_command_id, v_payload, p_expected_revision)
    when 'reconcile' then makeup_private.cmd_reconcile(a, p_command_id, v_payload, p_expected_revision)
  end;
  if v_res is null then
    perform makeup_private.fail('invalid', '지원하지 않는 작업입니다');
  end if;
  -- 요청이 효과 키를 보냈으면 그대로 돌려준다(어댑터의 재시도 대조용). 서버 키는 server_effect_key에 남는다.
  if makeup_private.p_text(v_payload, 'effect_key') is not null then
    v_res := v_res || jsonb_build_object('server_effect_key', v_res -> 'effect_key',
      'effect_key', makeup_private.p_text(v_payload, 'effect_key'));
  end if;
  insert into public.makeup_commands (tenant_id, command_id, action, actor_id, payload_hash, expected_revision, result, case_ids)
    values (a.tenant_id, p_command_id, p_action, a.user_id, v_hash, p_expected_revision, v_res,
      array(select x::uuid from jsonb_array_elements_text(coalesce(v_res -> 'case_ids', '[]'::jsonb)) x));
  perform set_config('makeup.ctx', '', true);
  return v_res;
end;
$$;

comment on function public.makeup_command(uuid, text, jsonb, integer) is
  '보강 원장의 유일한 쓰기 진입점(0347a). 행위자 = auth.uid(). 사용자 세션 클라이언트로만 부른다. 실패는 예외 + detail {"code"}.';

revoke all on function public.makeup_command(uuid, text, jsonb, integer) from public, anon, service_role;
grant execute on function public.makeup_command(uuid, text, jsonb, integer) to authenticated;
revoke all on all functions in schema makeup_private from public, anon, authenticated;
notify pgrst, 'reload schema';
