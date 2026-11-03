-- s2_0018 — 연동 PC(eywa_sync_agent)가 출결(attendance_records)을 읽게 한다 (2026-11-03, ClassNote 명부 퇴원처리 리뷰 B10·R9)
--
-- 왜: 명부 퇴원처리(전 과목 퇴원 45일 뒤 퇴소 — scripts/_classnote/classnote-offboard.mjs loadOffboardFacts)가
--     "퇴원일 뒤에 출결이 있으면 내리지 않는다"(수강 행 없이 자리·보강으로 다닌 경우)를 본다. 그런데 이 표는 연동 PC 역할에
--     읽기 권한·정책이 없다(운영 DB 실측 2026-11-03: has_table_privilege select = false · RLS 켜짐 · 이 역할 정책 0개).
--     게이트웨이는 `set local role eywa_sync_agent`로 돌려서 그 질의가 권한 오류(42501)로 실패한다(직결 드라이런은 통과해 안 보였다).
-- 무엇: 자기 지점 줄 **읽기만**(s2_0006·s2_0008·0390a와 같은 모양 · 쓰기 권한 없음). 앱 사용자 권한은 그대로.
--   🔴 grant와 정책은 **둘 다** 필요하다 — grant만 넣고 정책을 빼면 에러 없이 0행이라 그 가드가 조용히 꺼진다.
--   (워커도 한 겹 더 막는다: 그 지점의 가장 최근 출결이 없거나 14일보다 오래됐으면 그날 퇴원처리를 하지 않는다.)
-- 잠금: attendance_records는 매일 쓰는 표라 잠금을 오래 기다리며 다른 쓰기를 막지 않게 lock_timeout 3초(못 잡으면 실패 — 다시 실행).
--   `set local`이라 이 트랜잭션에만 걸린다(편집기 연결을 다시 써도 남지 않게 · 저장소 관례).
-- 적용 순서: 🔴 웹·AywaSync(퇴원처리 워커) 배포 **전에**. 이 SQL이 없으면 워커는 퇴원처리를 보류로 건너뛰지만(보고서 '보류' 한 줄),
--   그 질의 실패를 게이트웨이가 연동 PC 기록(sync_agent_events)에 job_failed(error)로 매일 남겨 **연동 화면에 오류가 뜬다**.
-- 적용 확인(읽기만):
--   select has_table_privilege('eywa_sync_agent', 'public.attendance_records', 'select') as can_select,
--          (select count(*) from pg_policies where schemaname = 'public' and tablename = 'attendance_records'
--             and policyname in ('sync_agent_allow', 'sync_agent_tenant_boundary')) as policies;   -- 기대: true · 2
--
-- 되돌리기(필요할 때만 — 이 파일을 다시 실행하지 말고 아래 세 줄을 따로 실행):
--   drop policy if exists sync_agent_tenant_boundary on public.attendance_records;
--   drop policy if exists sync_agent_allow on public.attendance_records;
--   revoke select on public.attendance_records from eywa_sync_agent;

begin;
set local lock_timeout = '3s';

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'eywa_sync_agent') then
    execute 'grant select on public.attendance_records to eywa_sync_agent';
    execute 'drop policy if exists sync_agent_allow on public.attendance_records';
    execute $p$create policy sync_agent_allow on public.attendance_records for select to eywa_sync_agent
      using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid)$p$;
    execute 'drop policy if exists sync_agent_tenant_boundary on public.attendance_records';
    execute $p$create policy sync_agent_tenant_boundary on public.attendance_records as restrictive for select to eywa_sync_agent
      using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid)$p$;
  else
    raise notice 's2_0018: eywa_sync_agent 역할이 없어 건너뜀';
  end if;
end $$;

commit;
