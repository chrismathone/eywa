-- 0359a: 교재 배정 차수 단위에 '25분 수업'(min25) 추가.
--
-- 원장 2026-10-13: "지금 교재배정할때 무조건 차수가 1시간씩 되어있는데 25분짜리도 만들어줘 차수단위를 25분씩짜리로".
-- 원장 2026-10-14 정정: "25분짜리 1시간수업이라도 하나만 들어가게 … 다른 교재로 또 25분 추가" — 배치는 period와 같이
-- 교시마다 1차수, 남는 시간은 다른 교재를 같은 교시에 배정한다. 배분 규칙은
-- 앱의 `buildLessonSchedule`(src/features/textbooks/lesson-schedule.ts) 한 곳에 있고 SQL엔 적지 않는다.
--
-- 바꾸는 것: CHECK 제약 하나(허용 값에 'min25'를 더한다). 표·행·RPC는 그대로.
-- 적용 전: 앱은 그대로 돌고, '25분 수업'으로 저장할 때만 한글 안내와 함께 거절된다.
-- 되돌리기(min25 행이 없을 때만):
--   alter table public.class_textbook_plans drop constraint class_textbook_plans_pace_chk;
--   alter table public.class_textbook_plans add constraint class_textbook_plans_pace_chk check (pace in ('period', 'day'));
set local statement_timeout = '60s';

alter table public.class_textbook_plans drop constraint if exists class_textbook_plans_pace_chk;
alter table public.class_textbook_plans
  add constraint class_textbook_plans_pace_chk check (pace in ('period', 'day', 'min25'));

comment on column public.class_textbook_plans.pace is
  '차수 단위 — period = 교시마다 1차수 / day = 하루에 1차수(그날 고른 교시 전부 같은 차수) / min25 = 25분 수업(배치는 교시마다 1차수, 남는 시간은 다른 교재 배정).';
