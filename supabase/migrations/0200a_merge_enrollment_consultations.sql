-- 0200a — 등록상담 병합 RPC (2026-08-11). 손수 alpha(드리즐 무관), 멱등(create or replace).
--
-- 배경(원장 2026-08-11): *"같은날에 시행되었거나 잘못작성되어 중복된 등록상담건이 있는데, 병합기능이 있나"*
-- 실측(운영 DB 2,206건): 같은 사람 2건+ = 181그룹, 그중 **같은 날 = 67그룹/135행**.
-- 기존엔 감지·힌트만 있고(상세 '같은 학생의 다른 등록상담') 정리 수단은 1건씩 삭제뿐이었다.
--
-- 🔴 왜 RPC인가 — 병합은 **순서가 곧 정확성**이라 한 트랜잭션이어야 한다:
--   ① 자식(녹음·AI분석) 이관 → ② 패자 삭제 → ③ 승자에 병합값 반영
--   ③을 ②보다 먼저 하면 `makeedu_id`·`legacy_key` 부분 유니크와 충돌한다(패자가 아직 그 키를 쥐고 있다).
--   ②를 먼저 하면 자식이 cascade로 함께 사라진다. 이 순서 말고는 답이 없다.
--
-- 🔴 어느 값을 남길지는 **DB가 판단하지 않는다** — 순수 함수 `planMerge`
--   ([src/features/enrollment/merge-plan.ts])가 정하고 사람이 확인한 결과(p_patch)만 여기로 온다.
--   판단을 SQL에도 두면 화면이 보여준 것과 실제 저장이 갈린다(로직 2벌 금지).
--
-- security invoker(0039a/0040a/0077a 패턴): 호출자의 RLS가 그대로 적용 + auth_tenant_id() 이중격리.
--   · enrollment_consultations / consultation_ai_analysis / consultation_recordings = `for all` 정책이라 이관·삭제 가능.
--   · makeedu_push_requests = **select 전용**(write는 service_role)이라 이관할 수 없다 → 대기 중 요청이 있으면
--     조용히 cascade로 지우지 않고 **예외로 멈춘다**(실측 후보 225그룹 중 해당 0건이라 평시엔 안 걸린다).

create or replace function public.merge_enrollment_consultations(
  p_winner uuid,
  p_losers uuid[],
  p_patch  jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tenant     uuid := auth_tenant_id();
  v_moved_ai   int := 0;
  v_dropped_ai int := 0;
  v_moved_rec  int := 0;
  v_deleted    int := 0;
  v_pending    int := 0;
  v_assign     text;
begin
  if v_tenant is null then
    raise exception 'merge_enrollment_consultations: 인증된 테넌트가 없습니다';
  end if;
  if p_winner is null or p_losers is null or array_length(p_losers, 1) is null then
    raise exception 'merge_enrollment_consultations: 대상이 비었습니다';
  end if;
  if p_winner = any(p_losers) then
    raise exception 'merge_enrollment_consultations: 남길 상담이 지울 목록에 들어 있습니다';
  end if;
  -- ⚠️ 배열에 NULL이 섞이면 아래 존재 검사도 삭제도 **조용히 아무 것도 안 하고 성공으로 보고**된다
  --    (`id = NULL`은 참이 아니고 count(distinct)는 NULL을 안 센다). 병합했다는 착각이 가장 나쁘다.
  if exists (select 1 from unnest(p_losers) x where x is null) then
    raise exception 'merge_enrollment_consultations: 지울 목록에 빈 값이 있습니다';
  end if;

  -- 대상이 전부 같은 테넌트의 실재 행인지 확인. RLS가 이미 막지만, 개수가 안 맞으면
  -- **일부만 병합된 채 성공으로 보고**되므로 여기서 멈춘다.
  if (select count(distinct id) from enrollment_consultations
      where tenant_id = v_tenant and id = any(array_append(p_losers, p_winner)))
     <> (select count(distinct x) from unnest(array_append(p_losers, p_winner)) x) then
    raise exception 'merge_enrollment_consultations: 대상 상담을 찾을 수 없습니다';
  end if;

  -- 🔴 대기 중 makeedu 푸시가 걸린 패자는 막는다 — 이관 권한이 없어 cascade로 사라지기 때문.
  select count(*) into v_pending
  from makeedu_push_requests
  where tenant_id = v_tenant and consultation_id = any(p_losers) and status in ('pending', 'running');
  if v_pending > 0 then
    raise exception 'merge_enrollment_consultations: makeedu 전송 대기 중인 상담은 병합할 수 없습니다(%건)', v_pending;
  end if;

  -- ① 자식 이관 ---------------------------------------------------------------
  -- AI 분석은 (consultation_id, model_version) 유니크라, 승자에 이미 같은 모델 분석이 있으면 옮길 수 없다.
  -- 그 경우는 **같은 모델이 같은 사람을 분석한 중복**이므로 패자 쪽을 버린다(승자 것이 남는다).
  delete from consultation_ai_analysis a
  where a.consultation_id = any(p_losers)
    and exists (
      select 1 from consultation_ai_analysis w
      where w.consultation_id = p_winner and w.model_version = a.model_version
    );
  get diagnostics v_dropped_ai = row_count;

  update consultation_ai_analysis set consultation_id = p_winner
  where consultation_id = any(p_losers);
  get diagnostics v_moved_ai = row_count;

  update consultation_recordings set consultation_id = p_winner, updated_at = now()
  where tenant_id = v_tenant and consultation_id = any(p_losers);
  get diagnostics v_moved_rec = row_count;

  -- ② 패자 삭제 — 여기서 지워야 ③의 makeedu_id·legacy_key 부분 유니크 자리가 비어 있다.
  delete from enrollment_consultations
  where tenant_id = v_tenant and id = any(p_losers);
  get diagnostics v_deleted = row_count;

  -- ③ 승자에 병합값 반영 -------------------------------------------------------
  -- 🔴 컬럼을 손으로 열거하지 않는다 — 63개를 적어 두면 컬럼이 하나 늘 때 **조용히 빠진다**.
  --    대신 patch의 키를 실재 컬럼과 대조해 걸러내고(존재 확인 = 주입 방어 1),
  --    %I로 식별자 인용해(주입 방어 2) 동적 SET을 만든다.
  --    보호 컬럼(id·tenant_id·created_at)은 무슨 일이 있어도 제외 — 테넌트를 갈아치우는 patch를 막는다.
  if p_patch is not null and jsonb_typeof(p_patch) = 'object' then
    select string_agg(format('%I = r.%I', k.key, k.key), ', ')
    into v_assign
    from jsonb_object_keys(p_patch) as k(key)
    where k.key not in ('id', 'tenant_id', 'created_at', 'updated_at')
      and exists (
        select 1 from information_schema.columns c
        where c.table_schema = 'public'
          and c.table_name = 'enrollment_consultations'
          and c.column_name = k.key
      );

    if v_assign is not null then
      execute format(
        'update enrollment_consultations ec set %s
           from jsonb_populate_record(null::enrollment_consultations, $1) r
          where ec.id = $2 and ec.tenant_id = $3',
        v_assign
      ) using p_patch, p_winner, v_tenant;
      -- updated_at은 enrollment_consultations_set_updated_at 트리거(0002a)가 올린다.
    end if;
  end if;

  return jsonb_build_object(
    'winner', p_winner,
    'deleted', v_deleted,
    'movedAnalysis', v_moved_ai,
    'droppedAnalysis', v_dropped_ai,
    'movedRecordings', v_moved_rec
  );
end;
$$;

comment on function public.merge_enrollment_consultations(uuid, uuid[], jsonb) is
  '등록상담 병합 — 자식 이관 → 패자 삭제 → 승자 갱신을 한 트랜잭션으로. 어느 값을 남길지는 앱(planMerge)이 정한다.';

revoke all on function public.merge_enrollment_consultations(uuid, uuid[], jsonb) from public;
grant execute on function public.merge_enrollment_consultations(uuid, uuid[], jsonb) to authenticated;
