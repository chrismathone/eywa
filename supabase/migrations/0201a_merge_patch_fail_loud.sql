-- 0201a — 병합 patch가 이상하면 **조용히 넘어가지 말고 멈춘다** (2026-08-11). 멱등(create or replace).
--
-- 🔴 배경(0200a 실행 시험에서 발견): 0200a는 patch 모양을 검사만 하고 아니면 **건너뛰었다**.
--    `if p_patch is not null and jsonb_typeof(p_patch) = 'object' then ... end if;`
--    그런데 이 함수는 그 전에 **이미 패자를 지운 뒤**다. 즉 patch가 잘못 오면
--      "패자는 삭제됐는데 승자에는 아무것도 반영 안 됨" = **정보가 조용히 사라진다**.
--    실제로 시험 하네스가 postgres.js 이중 인코딩([[#82]])으로 jsonb 문자열 스칼라를 보냈더니
--    `deleted:1`을 성공으로 돌려주면서 병합값(학부모 이름·이어붙인 상담 메모)은 통째로 유실됐다.
--    앱 경로(supabase-js → PostgREST)는 jsonb를 제대로 보내므로 프로덕션에서 재현되진 않았지만,
--    **되돌릴 수 없는 작업에서 "모양이 이상하면 그냥 넘어간다"는 실패 방식 자체가 틀렸다.**
--
-- 고치는 것 두 가지 — 둘 다 **어떤 변경보다도 먼저** 검사한다(지우기 전에 멈춰야 의미가 있다):
--   ① p_patch가 jsonb object가 아니면 예외.
--   ② patch에 키가 있는데 실재 컬럼과 하나도 안 맞으면 예외(오타·컬럼 개명으로 통째 무시되는 것 차단).
-- 나머지 로직은 0200a와 동일하다.

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
  v_keys       int := 0;
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
  if exists (select 1 from unnest(p_losers) x where x is null) then
    raise exception 'merge_enrollment_consultations: 지울 목록에 빈 값이 있습니다';
  end if;

  -- ⓪ 🔴 patch 검사를 **지우기 전에** 끝낸다. 여기서 통과 못 하면 아무것도 건드리지 않는다.
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'merge_enrollment_consultations: 병합값(patch)이 객체가 아닙니다(%). 호출부 직렬화를 확인하세요',
      coalesce(jsonb_typeof(p_patch), 'null');
  end if;

  select count(*) into v_keys from jsonb_object_keys(p_patch);

  -- patch의 키를 실재 컬럼과 대조(존재 확인 = 주입 방어 1) + %I 인용(주입 방어 2)로 동적 SET을 만든다.
  -- 보호 컬럼(id·tenant_id·created_at·updated_at)은 무슨 일이 있어도 제외.
  select string_agg(format('%I = r.%I', k.key, k.key), ', ')
  into v_assign
  from jsonb_object_keys(p_patch) as k(key)
  where k.key not in ('id', 'tenant_id', 'created_at', 'updated_at')
    and exists (
      select 1 from pg_attribute a
      where a.attrelid = 'public.enrollment_consultations'::regclass
        and a.attname = k.key and a.attnum > 0 and not a.attisdropped
    );

  -- 키는 왔는데 하나도 못 붙었다 = 컬럼명이 틀렸다는 뜻. 지우기 전에 멈춘다.
  if v_keys > 0 and v_assign is null then
    raise exception 'merge_enrollment_consultations: 병합값의 컬럼을 하나도 찾지 못했습니다(키 %개)', v_keys;
  end if;

  -- 대상이 전부 같은 테넌트의 실재 행인지 확인.
  if (select count(distinct id) from enrollment_consultations
      where tenant_id = v_tenant and id = any(array_append(p_losers, p_winner)))
     <> (select count(distinct x) from unnest(array_append(p_losers, p_winner)) x) then
    raise exception 'merge_enrollment_consultations: 대상 상담을 찾을 수 없습니다';
  end if;

  -- 대기 중 makeedu 푸시가 걸린 패자는 막는다 — 이관 권한이 없어 cascade로 사라지기 때문.
  select count(*) into v_pending
  from makeedu_push_requests
  where tenant_id = v_tenant and consultation_id = any(p_losers) and status in ('pending', 'running');
  if v_pending > 0 then
    raise exception 'merge_enrollment_consultations: makeedu 전송 대기 중인 상담은 병합할 수 없습니다(%건)', v_pending;
  end if;

  -- ① 자식 이관 --------------------------------------------------------------
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

  -- ③ 승자에 병합값 반영.
  if v_assign is not null then
    execute format(
      'update enrollment_consultations ec set %s
         from jsonb_populate_record(null::enrollment_consultations, $1) r
        where ec.id = $2 and ec.tenant_id = $3',
      v_assign
    ) using p_patch, p_winner, v_tenant;
    if not found then
      raise exception 'merge_enrollment_consultations: 남길 상담에 병합값을 반영하지 못했습니다';
    end if;
  end if;

  return jsonb_build_object(
    'winner', p_winner,
    'deleted', v_deleted,
    'movedAnalysis', v_moved_ai,
    'droppedAnalysis', v_dropped_ai,
    'movedRecordings', v_moved_rec,
    'patchedColumns', coalesce(array_length(string_to_array(v_assign, ', '), 1), 0)
  );
end;
$$;

comment on function public.merge_enrollment_consultations(uuid, uuid[], jsonb) is
  '등록상담 병합 — 자식 이관 → 패자 삭제 → 승자 갱신을 한 트랜잭션으로. patch가 이상하면 지우기 전에 멈춘다(0201a).';

revoke all on function public.merge_enrollment_consultations(uuid, uuid[], jsonb) from public;
grant execute on function public.merge_enrollment_consultations(uuid, uuid[], jsonb) to authenticated;
