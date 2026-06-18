-- 학생(enrollment) 일괄 반이동 RPC — 편집 모드 '저장' 시 보류 이동들을 한 번에 커밋.
-- 손수 alpha 파일(drizzle 무관, 함수). 적용: node --env-file=.env.local raw 실행.
--
-- 설계:
--  - SECURITY INVOKER → 호출자(authenticated) 권한으로 실행 → RLS(tenant_isolation) 그대로 강제.
--    service_role 미사용(테넌트 누수 방지). supabase.rpc()가 user JWT를 전달해 auth_tenant_id() 동작.
--  - 함수 전체가 단일 트랜잭션. 각 이동은 BEGIN/EXCEPTION(서브트랜잭션)으로 감싸 1건 실패가
--    나머지를 깨지 않음 → per-move 결과 배열 반환. ijw writeBatch(500청크 비원자)보다 견고.
--  - 이동 = 기존 enrollment end_date=오늘 + is_transferred=true, 새 enrollment(is_transferred_in=true).
--    enrollment를 삭제하지 않음(attendance_records/invoices FK 보존).

create or replace function public.move_enrollments_batch(p_moves jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  m            jsonb;
  v_enr_id     uuid;
  v_new_class  uuid;
  v_start      date;
  v_today      date := current_date;
  v_student    uuid;
  v_tenant     uuid;
  v_old_end    date;
  v_results    jsonb := '[]'::jsonb;
begin
  for m in select value from jsonb_array_elements(coalesce(p_moves, '[]'::jsonb)) as t(value)
  loop
    v_enr_id    := nullif(m->>'enrollmentId','')::uuid;
    v_new_class := nullif(m->>'newClassId','')::uuid;
    v_start     := coalesce(nullif(m->>'startDate','')::date, v_today);

    begin
      if v_enr_id is null or v_new_class is null then
        raise exception 'invalid_move';
      end if;

      -- 기존 enrollment (RLS가 본 테넌트로 제한 → 없으면 not_found)
      select student_id, tenant_id, end_date
        into v_student, v_tenant, v_old_end
        from public.enrollments
       where id = v_enr_id;

      if v_student is null then
        raise exception 'not_found';
      end if;

      -- 1) 기존 종료 + 반이동 흔적
      update public.enrollments
         set end_date = v_today, withdrawal_reason = '반 이동', is_transferred = true
       where id = v_enr_id;

      -- 2) 새 반에 등록(반이동 유입). GiST 충돌 시 이 서브트랜잭션만 롤백.
      insert into public.enrollments
        (tenant_id, student_id, class_id, start_date, is_transferred_in)
        values (v_tenant, v_student, v_new_class, v_start, true);

      v_results := v_results || jsonb_build_object('enrollmentId', v_enr_id, 'ok', true);
    exception when others then
      v_results := v_results
        || jsonb_build_object('enrollmentId', coalesce(v_enr_id::text, m->>'enrollmentId'),
                              'ok', false, 'error', sqlerrm);
    end;
  end loop;

  return v_results;
end;
$$;
