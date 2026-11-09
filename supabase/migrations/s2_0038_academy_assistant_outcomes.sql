-- s2_0038_academy_assistant_outcomes.sql — 학원 비서: 비서 의견 결과 재측정(제안 → 결과 → 학습 2단계) · 2026-11-09
--
-- 원장 2026-11-06 *"그 해결책이 어떤 결과를 가져왔는지에 대한 결과 피드백까지 할 수 있게해서 지속적인 학습이 이루어지도록"*.
-- 1단계(s2_0036)가 남긴 확인 지표를 다시 잴 날에 같은 조회문으로 다시 재어(크론 /api/cron/assistant-outcomes · 매일 05:10 KST)
-- 개선 · 변화 없음 · 악화 · 판정 보류로 남긴다. 설계 = docs/features/academy-assistant.md §7-6.
--
-- 🔴 원장 승인 전 운영 적용 금지. 순서 = 이 SQL → 앱 배포(새 앱이 이 칸을 읽는다 — 앱을 먼저 올리면 의견 상태 읽기가 실패해 처리 단추가 빠진다).
--    되돌리기 = scripts/_oneoff/revert-s2_0038-academy-assistant-outcomes.sql(앱 먼저 되돌린 뒤).
--
-- 바꾸는 것 — assistant_advice에 결과 칸만 더한다(새 칸은 모두 비워 둔 채로 · 기존 줄·제약·트리거·권한은 그대로):
--   latest_verdict · latest_value · latest_sample(재측정 기간 값·표본) · latest_base · latest_base_sample(같은 날 기준 기간을 다시 잰 값 —
--   늦게 들어온 기록까지 같은 조건으로 견준다) · latest_from · latest_to(재측정 기간) · latest_delta · latest_threshold · latest_reason ·
--   latest_checked_at · checks_done · fail_count · last_error ·
--   measure_anchor(재측정 기간의 기준일 — 원장이 '완료'를 누르면 그 날로 다시 잡는다 · 비어 있으면 질문일 = 기준값 기간 끝 + 2일).
--   표는 RLS 정책 0 · service_role만 · 비서 보기 제외 그대로(s2_0036) — 크론도 앱 관리자 연결로 쓴다.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.assistant_advice
  add column if not exists latest_verdict text check (latest_verdict in ('improved', 'flat', 'worse', 'unknown')),
  add column if not exists latest_value numeric,
  add column if not exists latest_sample numeric check (latest_sample is null or latest_sample >= 0),
  add column if not exists latest_base numeric,
  add column if not exists latest_base_sample numeric check (latest_base_sample is null or latest_base_sample >= 0),
  add column if not exists latest_from date,
  add column if not exists latest_to date,
  add column if not exists latest_delta numeric,
  add column if not exists latest_threshold numeric,
  add column if not exists latest_reason text check (char_length(latest_reason) <= 200),
  add column if not exists latest_checked_at timestamptz,
  add column if not exists checks_done smallint not null default 0 check (checks_done between 0 and 10),
  add column if not exists fail_count smallint not null default 0 check (fail_count between 0 and 10),
  add column if not exists last_error text check (char_length(last_error) <= 200),
  add column if not exists measure_anchor date;

-- 판정이 있으면 재측정 기간·잰 때가 함께 있다.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'assistant_advice_latest_complete') then
    alter table public.assistant_advice add constraint assistant_advice_latest_complete
      check (latest_verdict is null or (latest_from is not null and latest_to is not null and latest_from < latest_to and latest_checked_at is not null));
  end if;
end $$;

-- ── 사후 확인 ──────────────────────────────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'assistant_advice'
         and column_name in ('latest_verdict', 'latest_value', 'latest_sample', 'latest_base', 'latest_base_sample', 'latest_from', 'latest_to',
                             'latest_delta', 'latest_threshold', 'latest_reason', 'latest_checked_at', 'checks_done', 'fail_count', 'last_error', 'measure_anchor')) <> 15 then
    raise exception 's2_0038: 결과 칸이 다 생기지 않았습니다';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'assistant_advice') then
    raise exception 's2_0038: 정책이 생기면 안 됩니다(service_role만 쓴다)';
  end if;
  if has_table_privilege('authenticated', 'public.assistant_advice', 'select') or has_table_privilege('anon', 'public.assistant_advice', 'select') then
    raise exception 's2_0038: 로그인·비로그인 사용자가 의견 표를 읽을 수 있습니다';
  end if;
  if to_regclass('assistant.assistant_advice') is not null then
    raise exception 's2_0038: 비서 보기에 의견 표가 있습니다';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
