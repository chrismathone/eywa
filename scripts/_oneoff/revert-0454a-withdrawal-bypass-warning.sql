-- 되돌리기 — 0454a 퇴원보고서 없이 퇴원 = 경고. 🔴 적용 SQL이 아니다(되돌릴 때만 운영자가 따로 실행).
-- 이미 남은 경고 알림(`notifications.type = 'withdrawal_bypass'`)·감사로그(`student_withdrawn_without_report`)는 지우지 않는다(있었던 일의 기록이다).
-- 🔴 순서: 트리거 먼저 → 함수 → 스키마. 함수를 먼저 지우면 트리거가 남아 학생 퇴원 쓰기가 커밋 때 실패한다.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

drop trigger if exists zz_withdrawal_without_report_warning on public.students;
drop trigger if exists zz_withdrawal_without_report_warning_insert on public.students;
drop function if exists withdrawal_guard_private.warn_unreported_withdrawal();
drop schema if exists withdrawal_guard_private;

notify pgrst, 'reload schema';

commit;
