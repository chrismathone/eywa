-- s2_0006 — 영어 반 ↔ ClassNote 영어 반 방 연결 (2026-10-29, 원장 *"반 방 경로로 영어 발송 만들어줘"*)
--
-- 왜: 영어 배달은 **그룹 반 방에 학생별 게시**로 확정돼 있었다(docs/english-report-plan.md 결정 1 — 2026-07-29 실측
--     847건 전부 반 방 · `(영어)이름` 1인 보드 229개는 게시 0). 그런데 워커는 영어를 1인 보드로만 보내서, 1인 보드가
--     빈 학생은 "연결된 원아가 없습니다"로 실패하고(10/28 김준서A·이준혁) 나머지는 학부모 화면에 학생 이름 보드로 섞여 갔다.
--
-- 무엇: aywa 영어 반 하나 → ClassNote 영어 반 방 하나. 워커가 보고서 반(보강은 보강 반)의 연결을 찾으면
--     그 반 방의 **이 학생 원아에게만**(0185a `classnote_child_links` 확정 원아 ∩ 지금 그 반 방 원아) 1:1로 올린다.
--     연결이 없는 반은 종전대로 1인 보드로 간다(이 표가 비면 동작이 지금과 같다).
--
-- 🔴 수학 연결표(0302a `classnote_class_boards`)를 쓰지 않는 이유: 수학 매일 동기화가 그 표에서 **수학 대상이 아닌 반의
--    연결을 지우고**(math-class-boards-db.mjs) 연결된 보드의 **이름을 aywa 반 이름으로 바꾸고 원아·선생님을 배정·해제**한다.
--    영어 반 방은 선생님들이 ClassNote에서 직접 관리해 온 방이라 그 동기화가 손대면 안 된다 — 표를 나눠 아예 못 보게 한다.
-- 🔴 보드 이름이 aywa 반 이름과 다르다(`중등E_초6 MED a` ↔ `Jennifer 초6 MED a (화수금)`) — 이름으로 잇지 않는다.
--    연결은 사람이 확인한 것만 넣는다(제안 = scripts/_classnote/link-english-class-boards.mjs, 들어 있는 원아가 겹치는 정도).
-- 쓰기 = service_role(스크립트·SQL)만. 앱 사용자 쓰기 정책을 두지 않는다(0302a와 같은 이유 — 사용자가 넣은 연결이
--    "안전한 타깃"으로 승격되면 오발송이다). 연동 PC(eywa_sync_agent)는 **읽기만** 한다.
-- 앱·워커는 이 SQL 전에도 죽지 않는다([[#95]]) — 워커는 표가 없으면 종전 1인 보드 경로로 간다.

create table if not exists public.classnote_english_class_boards (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  board_id bigint not null,          -- ClassNote 반 방 id
  board_name text not null,          -- 연결 당시 보드 이름(표시·로그용 — 판정에 쓰지 않는다)
  linked_by text,                    -- 어떤 근거로 이었나(예: 'overlap 12/12 · 원장 확인 2026-10-29')
  created_at timestamptz not null default now(),
  primary key (tenant_id, class_id)
);
create index if not exists classnote_english_class_boards_board_idx
  on public.classnote_english_class_boards (tenant_id, board_id);

alter table public.classnote_english_class_boards enable row level security;

-- 읽기 = 테넌트 멤버(발송 콘솔·반 구성 화면). 정책이 없으면 에러 없이 0행이다([[#104]]).
drop policy if exists classnote_english_class_boards_tenant_read on public.classnote_english_class_boards;
create policy classnote_english_class_boards_tenant_read on public.classnote_english_class_boards
  for select using (tenant_id = auth_tenant_id());

revoke insert, update, delete on public.classnote_english_class_boards from anon, authenticated;
grant all on public.classnote_english_class_boards to service_role;

-- 연동 앱(발송 PC) 워커 = eywa_sync_agent — 자기 지점 줄만 **읽는다**(0390a와 같은 모양 · 역할이 없는 DB면 건너뛴다).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'eywa_sync_agent') then
    execute 'grant select on public.classnote_english_class_boards to eywa_sync_agent';
    execute 'drop policy if exists sync_agent_allow on public.classnote_english_class_boards';
    execute $p$create policy sync_agent_allow on public.classnote_english_class_boards for select to eywa_sync_agent
      using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid)$p$;
    execute 'drop policy if exists sync_agent_tenant_boundary on public.classnote_english_class_boards';
    execute $p$create policy sync_agent_tenant_boundary on public.classnote_english_class_boards as restrictive for select to eywa_sync_agent
      using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid)$p$;
  else
    raise notice 's2_0006: eywa_sync_agent 역할이 없어 워커 권한을 건너뜀';
  end if;
end $$;

comment on table public.classnote_english_class_boards is
  'aywa 영어 반 ↔ ClassNote 영어 반 방(s2_0006). 사람이 확인한 연결만. 워커가 그 반 방의 이 학생 원아에게 1:1로 올린다. 수학 동기화는 이 표를 모른다.';

notify pgrst, 'reload schema';
