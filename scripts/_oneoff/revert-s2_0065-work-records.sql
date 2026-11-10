-- s2_0065 되돌리기 — 업무 작성센터 표를 지운다(작성한 업무 문서와 변경 기록이 함께 사라진다).
-- 🔴 적용 SQL이 아니다. 앱을 이 기능 이전 판으로 되돌린 **뒤에만**, 원장 승인 뒤 손으로 실행한다([[#95]]).
-- s2_0067(조직·OKR)의 '업무 문서' 근거 집계가 이 표를 읽는다 — OKR을 남겨 두면 그 근거만 비게 된다.
begin;
drop function if exists public.save_academy_work_record(uuid,uuid,uuid,uuid,integer,boolean,jsonb);
drop table if exists public.academy_work_record_events;
drop table if exists public.academy_work_records;
commit;
notify pgrst, 'reload schema';
