-- 0209a — 직원 '자리 출석부 담당' 토글 (랩실 · JJ실).
--
-- 배경(원장 2026-08-14): *"직원 설정에 '랩실 출석부 담당, JJ실 출석부 담당' 기능 신설하고
-- 해당 기능에 토글되어있는 직원은 로그인시 해당 출석부가 강사뷰처럼 보이도록."*
--
-- 선례: users.attendance_alert_optin (0184a, 셔틀 출결 알림 토글). 자리 두 개를 각각 켜야
-- 해서 boolean 두 칸이다(배열 한 칸이면 '둘 다'를 표현은 되지만 토글 UI·부분 갱신이 지저분하다).
--
-- 앱은 컬럼이 없어도 안 죽는다(#95) — 조회는 실패 시 '담당 아님', 직원 저장은 이 두 칸만 빼고
-- 나머지를 남긴다. 그래도 토글이 실제로 켜지려면 이 SQL을 먼저 돌려야 한다.
--
-- 멱등: add column if not exists.
-- 롤백: alter table users drop column seat_lab_duty, drop column seat_jj_duty;

alter table users
  add column if not exists seat_lab_duty boolean not null default false;

alter table users
  add column if not exists seat_jj_duty boolean not null default false;

comment on column users.seat_lab_duty is
  '랩실 출석부 담당. true면 로그인 착지가 랩실 출석부이고 그 자리 출결만 쓸 수 있다(0209a).';

comment on column users.seat_jj_duty is
  'JJ실 출석부 담당. 토글은 저장되나 1차 오픈 범위(랩실만)에서는 착지·쓰기가 아직 열리지 않는다(0209a).';
