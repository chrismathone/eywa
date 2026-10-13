-- 0359a: 교재 배정 차수 단위에 '25분마다 1차수'(min25) 추가.
--
-- 원장 2026-10-13: "지금 교재배정할때 무조건 차수가 1시간씩 되어있는데 25분짜리도 만들어줘 차수단위를 25분씩짜리로".
-- 교시 길이를 25분으로 버림해 그 칸에 차수를 여러 개 넣는다(40분→1 · 60분→2 · 80분→3). 배분 규칙은
-- 앱의 `buildLessonSchedule`(src/features/textbooks/lesson-schedule.ts) 한 곳에 있고 SQL엔 적지 않는다.
--
-- 바꾸는 것: CHECK 제약 하나(허용 값에 'min25'를 더한다). 표·행·RPC는 그대로.
-- 적용 전: 앱은 그대로 돌고, '25분마다 1차수'로 저장할 때만 한글 안내와 함께 거절된다.
-- 되돌리기(min25 행이 없을 때만):
--   alter table public.class_textbook_plans drop constraint class_textbook_plans_pace_chk;
--   alter table public.class_textbook_plans add constraint class_textbook_plans_pace_chk check (pace in ('period', 'day'));
set local statement_timeout = '60s';

alter table public.class_textbook_plans drop constraint if exists class_textbook_plans_pace_chk;
alter table public.class_textbook_plans
  add constraint class_textbook_plans_pace_chk check (pace in ('period', 'day', 'min25'));

comment on column public.class_textbook_plans.pace is
  '차수 단위 — period = 교시마다 1차수 / day = 하루에 1차수(그날 고른 교시 전부 같은 차수) / min25 = 25분마다 1차수(교시 길이 버림, 한 칸에 여러 차수를 한 줄로 합쳐 적는다).';
