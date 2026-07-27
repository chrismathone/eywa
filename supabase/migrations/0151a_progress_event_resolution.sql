-- 0151a_progress_event_resolution.sql (손수 alpha)
-- 진도 이상(jump_error/overlap_error) "이상 없음 확인" — 사람이 보고 정상이라고 판정한 이벤트를 침묵시킨다.
--
-- 배경: 진도 점프의 상당수는 **정상**이다(선행 시작, 교재 건너뜀, 반 이동). 그런데 확인해도 끌 방법이
-- 없어 같은 신호가 계속 떠 있었다 — 원스크린 '진도 확인 필요' 배지 14일 + 학생 상세 진도 탭 이상 카드.
-- 끌 수 없는 경고는 결국 전부 무시된다(경보 피로) → 확인 도장을 찍을 자리를 만든다.
--
-- ⚠️ 이벤트 **삭제가 아니라 해소 표시**다 — 누가 언제 확인했는지 남고 되돌릴 수 있어야 한다
--    (지우면 오판을 되돌릴 수도, 감사할 수도 없다).
-- ⚠️ 컨테이너 상태(errored 등)는 건드리지 않는다 — 해소는 **신호 판정**이지 진도 데이터 정정이 아니다.
--    진도 자체가 틀렸다면 해당 수업보고서의 진도를 고치는 게 정답(그러면 재-ingest가 새 이벤트를 만든다).

alter table progress_events
  add column if not exists resolved_at timestamptz;
alter table progress_events
  add column if not exists resolved_by uuid references users(id) on delete set null;

comment on column progress_events.resolved_at is
  '이상 없음 확인 시각(NULL=미확인). 배지·이상 카드·알림 감지에서 제외된다. 0151a';
comment on column progress_events.resolved_by is
  '이상 없음 확인자(users.id). 되돌리기 시 NULL로 함께 되돌린다. 0151a';

-- 배지/카드/알림 감지는 전부 "미확인 오류 이벤트"를 찾는다 → 부분 인덱스로 좁힌다(전체 이벤트는 계속 증가).
create index if not exists progress_events_unresolved_error_idx
  on progress_events (student_id, created_at desc)
  where resolved_at is null and event_type in ('jump_error', 'overlap_error');

-- 0090a는 progress_events에 select/insert 정책만 만들었다 — update 정책이 없으면 RLS 기본 거부라
-- 확인 버튼이 "눌러도 아무 일이 없는" 상태가 된다. 형제 테이블 progress_containers_tenant_upd와 동형.
-- ⚠️ 테넌트 격리까지만 — **누가** 확인할 수 있는지(원장·사무실 전체 / 강사는 담당 학생만)는 서버 액션의
--    accessLevelTenant + teacherOwnsStudent 게이트가 판정한다(RLS로는 강사-학생 소유를 표현 못 함).
drop policy if exists progress_events_tenant_upd on progress_events;
create policy progress_events_tenant_upd on progress_events for update
  using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());

-- 신규 컬럼은 supabase-js(PostgREST)로 select/update되므로 스키마 캐시 리로드 필수(0061a·0062a 규약).
notify pgrst, 'reload schema';
