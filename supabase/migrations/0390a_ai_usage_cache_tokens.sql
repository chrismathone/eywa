-- 0390a — AI 사용량(0113a ai_usage_logs)에 프롬프트 캐시 토큰 두 칸.
-- 영상 설명 AI 참고 메모의 밤 배치가 Anthropic 프롬프트 캐시를 쓴다(원장 2026-10-21 "최소요금").
-- Anthropic의 input_tokens는 캐시에서 읽은 토큰을 **뺀** 값이라, 이 두 칸이 없으면 캐시를 켠 기능의 비용이 실제보다 적게 보인다.
--   cache_read_tokens  = 캐시에서 읽음(정가의 10%)
--   cache_write_tokens = 캐시에 씀(정가의 125%, 5분 보관)
-- 앱은 값이 0보다 클 때만 이 칸을 쓴다 — 열이 아직 없는 DB에서도 캐시를 안 쓰는 호출의 기록은 그대로 산다(#95 expand/contract).
-- 멱등.
alter table ai_usage_logs
  add column if not exists cache_read_tokens int,
  add column if not exists cache_write_tokens int;
comment on column ai_usage_logs.cache_read_tokens is '프롬프트 캐시에서 읽은 입력 토큰(정가의 10%) — input_tokens에 들어 있지 않다';
comment on column ai_usage_logs.cache_write_tokens is '프롬프트 캐시에 쓴 입력 토큰(정가의 125%) — input_tokens에 들어 있지 않다';
