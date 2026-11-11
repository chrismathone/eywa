-- s2_0058 되돌리기 — 직원 삭제 차단 기록을 세는 함수를 뺀다.
-- 🔴 적용 SQL이 아니다. 앱을 s2_0058 이전 판으로 되돌리고 **s2_0060(delete_staff_account)를 먼저 되돌린 뒤에만** 실행한다
--    — s2_0060가 이 함수를 부른다(이 함수만 빼면 직원 완전 삭제가 오류로 막힌다 · 지워지는 것은 없다).
drop function if exists public.staff_delete_blockers(uuid);
notify pgrst, 'reload schema';
