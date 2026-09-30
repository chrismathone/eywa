-- 0311a: 슬랙 규칙 '누가'(발동자) 포함 필터.
-- 비어 있으면 누구든 보낸다(기존 규칙 그대로). 채우면 그 사람이 한 일만 보낸다 —
-- 발동자가 없는 것(시스템 자동 알림·PIN 화면 기록)은 맞지 않아 빠진다. exclude_actor_ids(빼기)와 겹치면 빼기가 이긴다.
-- 앱은 이 칸이 없어도 돈다([[#95]] — 없으면 '누가'가 빈 규칙만 저장, 채운 규칙은 저장을 거절).
-- 멱등: add column if not exists.

alter table public.slack_rules add column if not exists actor_ids uuid[] not null default '{}';

comment on column public.slack_rules.actor_ids is
  '누가(발동자) 포함 필터 — 비면 누구든, 채우면 이 사람들이 한 일만(발동자 없는 시스템·PIN 기록 제외). exclude_actor_ids와 겹치면 제외가 이긴다.';

notify pgrst, 'reload schema';
