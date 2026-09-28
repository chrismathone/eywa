-- 0300a — 슬랙 규칙: 키마다 "언제부터 이 규칙이 그 키를 보냈나" (2026-09-28, codex 3차 검토).
--
-- 왜: 유실 대조(reconcileInbox)는 트리거가 삼킨 예외로 인박스에 못 들어간 사건을 되살린다. 이때 "규칙이 그 키를 갖기
--     전의 사건"까지 되살리면 규칙을 만들거나 키를 더한 직후 과거 30분이 쏟아진다. 0298a엔 규칙 전체의 updated_at뿐이라
--     그것을 기준으로 썼더니, 사건 뒤에 규칙을 (이름만이라도) 고치면 그 사건이 대조에서 빠졌다.
--     → 키마다 추가된 시각을 적는다(`{ "student_create": "2026-09-28T…Z", … }`). 규칙을 고쳐도 이미 있던 키의 시각은 그대로.
-- 앱: 없는 키는 규칙의 created_at으로 본다(0300a 전에 저장된 규칙). 칸이 없으면 대조는 조용히 건너뛴다([[#95]]).
-- 멱등: add column if not exists.

alter table public.slack_rules add column if not exists key_since jsonb not null default '{}'::jsonb;

notify pgrst, 'reload schema';
