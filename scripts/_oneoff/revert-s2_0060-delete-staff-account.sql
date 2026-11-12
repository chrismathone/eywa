-- s2_0060 되돌리기 — 직원 완전 삭제를 한 거래로 하는 함수를 뺀다.
-- 🔴 적용 SQL이 아니다. 앱을 s2_0060 이전 판으로 되돌린 **뒤에만** 실행한다 — 새 앱의 직원 완전 삭제는 이 함수만 부른다
--    (함수가 없으면 삭제가 오류로 막힌다 · 지워지는 것은 없다). 이 함수는 데이터를 바꾸지 않고 만들어졌으므로 빼도 기록은 그대로다.
drop function if exists public.delete_staff_account(uuid, uuid);
notify pgrst, 'reload schema';
