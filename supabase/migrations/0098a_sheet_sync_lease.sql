-- 0098a: 시트 반영/가져오기 동시 실행 방지 리스(lease)
-- syncSheetsNow(DB→시트 통째 push)와 시트 가져오기 apply가 같은 provider 행의 sync_started_at을
-- 원자 claim(UPDATE ... WHERE null 또는 stale)해 직렬화한다. 창=iframe 멀티윈도우라 클라 disabled는
-- 한 창만 커버 — 서버측 공유 락이 필요(2026-07-13 동시성 전수조사). 3분 초과 리스는 stale로 재클레임.
alter table public.user_integrations
  add column if not exists sync_started_at timestamptz;

comment on column public.user_integrations.sync_started_at is
  '시트 동기화(반영/가져오기 apply) 진행 중 리스 락 — null=유휴, 3분 초과=stale(재클레임 가능)';
