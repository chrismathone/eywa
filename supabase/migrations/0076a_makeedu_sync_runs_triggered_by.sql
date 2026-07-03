-- 0076a: makeedu 동기화 실행 로그에 "누가 실행했는지"(사용자) 기록.
-- 수동 실행(button/relay = 앱 '지금 동기화' 버튼)은 triggered_by = 그 버튼을 누른 user id를 남긴다.
-- 자동(scheduled = 작업 스케줄러)·CLI(manual)는 사용자가 없으므로 null → UI에서 "[자동 실행]"로 표시.
-- on delete set null: 사용자가 삭제돼도 실행 로그 행은 보존(누구인지만 비게 됨).
alter table makeedu_sync_runs
  add column if not exists triggered_by uuid references users(id) on delete set null;
