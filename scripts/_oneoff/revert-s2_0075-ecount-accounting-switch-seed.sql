-- s2_0075 되돌리기 — ECOUNT 회계 자료 가져오기 지점 스위치 줄을 지운다(모든 지점에서 회계 자료 올리기가 꺼진다 · 저장된 회계 자료는 그대로).
-- 🔴 앱을 먼저 되돌린 뒤. 운영 콘솔에서 따로 켠 지점의 줄도 함께 지워진다.
begin;
delete from public.tenant_licenses where feature = 'ecount_accounting';
commit;
