-- 0125a: 알림 보관(archive) — 벨 목록에서 치우되 보관함 뷰에서 다시 볼 수 있게
-- (2026-07-20 원장 "알림 보관/삭제 기능 추가하자". 삭제는 0074a recipient delete 정책으로 이미 가능 —
--  이 마이그는 보관 컬럼 + 비보관 핫패스 인덱스만 추가한다. 자동 정리(prune: 읽은 알림 90일)는 불변이며
--  보관된 알림도 read_at 기준으로 동일하게 정리된다.)
--
-- ⚠️ drizzle journal 밖(손수 alpha). 신규 DB는 pnpm db:alphas가 사전순 적용. 멱등.

alter table notifications add column if not exists archived_at timestamptz;

-- 벨 기본 목록(비보관 최신순) — 보관이 쌓여도 기본 뷰가 안정되게 부분 인덱스.
create index if not exists notifications_recipient_active_idx
  on notifications (recipient_id, created_at desc) where archived_at is null;
