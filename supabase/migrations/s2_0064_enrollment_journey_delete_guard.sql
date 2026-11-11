-- s2_0064 — 신규 콜&상담 여정 기록을 상담 삭제·병합에서 지킨다 (Claude·Codex 검토 합의 2026-11-11 · s2_0063 뒤에 적용)
-- ✅ 운영 적용 2026-11-11(시험 거래 ROLLBACK 뒤 적용 · 트리거·함수·실행권 확인 · 적용본을 거래 안에서 다시 시험 후 ROLLBACK).
--
-- ① 삭제 차단: 집계 제외(voided)가 아닌 전화·방문·등록 기록이 걸린 상담은 지울 수 없다 — 확인 근거와 변경 이력이 함께 사라지고
--    전환 집계가 소급해서 바뀌기 때문. 잘못 넣은 기록은 '집계 제외', 중복 상담은 병합으로 정리한다. 집계 제외 기록만 남은 상담은 지워진다(종전 cascade).
--    🔴 앱의 사전 확인만으로는 '확인 → 삭제' 사이에 들어온 기록을 못 막는다. 그래서 상담 행의 BEFORE DELETE 트리거가 막는다:
--       삭제는 행 잠금을 잡은 뒤 트리거를 돌리고, 기록 저장(save_enrollment_journey)은 같은 상담 행을 FOR SHARE로 잡는다 →
--       저장이 먼저면 삭제가 기다렸다가 그 기록을 보고 멈추고, 삭제가 먼저면 저장이 '상담 연결을 확인해 주세요'로 멈춘다.
--    트리거는 **막기만 한다**(예외 통로 없음 — 누가 어떤 설정값을 걸어도 기록이 걸린 상담은 안 지워진다).
--    트리거는 정의자 권한(security definer) — 기록 표는 서버 전용이라 상담을 지우는 사람 권한으로는 못 읽는다.
-- ② 병합 = 한 거래: `merge_enrollment_consultations_with_journey`(서버 전용 — service_role만 실행)가
--    상담 행 잠금(FOR UPDATE · id 순) → 진 쪽 상담의 기록(집계 제외 포함)을 이긴 쪽으로 옮김 → 종전 병합 함수 호출을 한 거래로 묶는다.
--    종전엔 앱이 '기록 옮기기'와 '병합'을 따로 불러 그 사이에 저장된 기록이 진 쪽과 함께 지워질 수 있었다.
--    · 병합 권한(신규 콜&상담 쓰기)은 앱이 본다(`requireMergeWrite`) — 그래서 이 함수는 화면 계정(authenticated)에 실행권을 주지 않는다.
--    · 종전 병합 함수(`merge_enrollment_consultations` · 호출자 권한 · auth_tenant_id())를 **그대로 부른다**(병합 규칙은 한 벌).
--      서버 호출엔 로그인한 사람이 없으므로 이 거래 안에서만 요청자를 `p_actor`로 밝힌다(`request.jwt.claim.sub` — auth.uid()가 읽는 값).
--      → 지점 판정(auth_tenant_id)과 활동 기록(log_activity)의 '누가'가 화면에서 병합하던 때와 같다. `p_actor`가 `p_tenant`의 재직자인지 먼저 확인한다.
--    · 옛 병합 함수를 직접 부르면 기록이 걸린 진 쪽 상담에서 ①로 멈춘다(조용히 지워지지 않는다).
--    ⚠️ 옛 함수와 새 함수가 같은 상담 쌍을 동시에 병합하면 잠금 순서가 달라 한쪽이 교착으로 실패할 수 있다(40P01 · 다시 시도) —
--       앱이 새 함수만 부르게 된 뒤에는 생기지 않는다.
-- 지점(tenants) 삭제로 상담이 함께 지워질 때는 막지 않는다(기록도 같은 cascade로 지워진다).
-- 되돌리기: scripts/_oneoff/revert-s2_0064-enrollment-journey-delete-guard.sql (앱을 먼저 되돌린 뒤)
begin;
set local statement_timeout = '60s';

create function public.guard_consultation_journey_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- 지점이 통째로 지워지는 중이면 그대로 둔다.
  if not exists (select 1 from public.tenants where id = old.tenant_id) then return old; end if;
  if exists (select 1 from public.enrollment_journey_records
             where tenant_id = old.tenant_id and consultation_id = old.id and not voided) then
    raise exception '전화·방문·등록 기록이 있는 상담은 삭제할 수 없습니다. 잘못 입력한 기록은 집계 제외로 돌리거나, 중복 상담이면 병합해 주세요.'
      using errcode = 'P0001';
  end if;
  return old;
end $$;
revoke all on function public.guard_consultation_journey_delete() from public, anon, authenticated;

create trigger enrollment_consultations_journey_guard before delete on public.enrollment_consultations
  for each row execute function public.guard_consultation_journey_delete();

create function public.merge_enrollment_consultations_with_journey(p_tenant uuid, p_actor uuid, p_winner uuid, p_losers uuid[], p_patch jsonb)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_ids uuid[];
  v_found integer;
  v_moved uuid[];
  v_result jsonb;
  v_prev_sub text := current_setting('request.jwt.claim.sub', true);
begin
  if p_tenant is null or p_actor is null or p_winner is null or p_losers is null or array_length(p_losers, 1) is null
     or p_winner = any(p_losers) or exists (select 1 from unnest(p_losers) x where x is null) then
    raise exception '병합 대상을 확인해 주세요';
  end if;
  if not exists (select 1 from users where id = p_actor and tenant_id = p_tenant and status = 'active') then
    raise exception '담당자 정보를 확인해 주세요';
  end if;
  v_ids := array_append(p_losers, p_winner);
  -- 부모 상담을 먼저 잠근다(id 순 — 서로 반대로 잡는 교착을 피한다). 진행 중이던 기록 저장은 여기서 끝나기를 기다린다.
  perform 1 from enrollment_consultations where tenant_id = p_tenant and id = any(v_ids) order by id for update;
  -- 전부 이 지점의 실재 상담이어야 한다 — 하나라도 아니면 기록을 옮기기 전에 멈춘다.
  select count(*) into v_found from enrollment_consultations where tenant_id = p_tenant and id = any(v_ids);
  if v_found <> (select count(distinct x) from unnest(v_ids) x) then
    raise exception '대상 상담을 찾을 수 없습니다';
  end if;
  -- 진 쪽 상담의 기록을 이긴 쪽으로(집계 제외 기록·변경 이력 포함 — 이력은 기록 id를 따라간다). 문서·버전은 그대로.
  -- 옮긴 기록 id를 돌려준다 — 앱이 병합 감사로그에 남긴다(기록의 상담 이동은 기록의 변경 이력엔 안 남는다).
  with moved as (
    update enrollment_journey_records set consultation_id = p_winner
      where tenant_id = p_tenant and consultation_id = any(p_losers)
      returning id
  )
  select coalesce(array_agg(id order by id), '{}'::uuid[]) into v_moved from moved;
  -- 종전 병합 함수가 요청자를 알아보게 한다(이 거래 안에서만). 지점이 어긋나면 병합하지 않는다.
  perform set_config('request.jwt.claim.sub', p_actor::text, true);
  if auth_tenant_id() is distinct from p_tenant then
    raise exception '담당자 정보를 확인해 주세요';
  end if;
  v_result := merge_enrollment_consultations(p_winner, p_losers, p_patch);
  perform set_config('request.jwt.claim.sub', coalesce(v_prev_sub, ''), true);
  return coalesce(v_result, '{}'::jsonb)
    || jsonb_build_object('journey_moved', coalesce(array_length(v_moved, 1), 0), 'journey_moved_ids', to_jsonb(v_moved));
end $$;
revoke all on function public.merge_enrollment_consultations_with_journey(uuid, uuid, uuid, uuid[], jsonb) from public, anon, authenticated;
grant execute on function public.merge_enrollment_consultations_with_journey(uuid, uuid, uuid, uuid[], jsonb) to service_role;

notify pgrst, 'reload schema';
commit;
