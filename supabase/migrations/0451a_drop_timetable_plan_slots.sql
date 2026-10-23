-- 0451a — 시간표(개발중) 계획 칸 표(0232a) 지우기
--
-- 원장 2026-10-23: *"필요없음 계획 칸 표도 지워"* — 화면 `/timetable-dev`는 같은 날 코드째 지웠다(main ac1236af4).
-- 지우기 전에 확인한 것(운영 DB, 읽기만):
--   · 1,112행 = 08-31 한 번 '현재 시간표 복사'(8월 556) + '달 복사'(9월 556) · 만든 뒤 고친 행 0
--   · 이 표를 가리키는 연결(FK)·뷰·함수·트리거·정책·실시간 발행 0 · main 코드에서 읽고 쓰는 곳 0
-- 다음 달 시간표를 미리 짜 보는 일은 시간표 편집기(`/timetable/editor`, timetable-lab 표들)가 맡는다 —
-- 교재 배정 표 `class_textbook_plans`(0268a 파일 이름이 `…_plan_slots`라 헷갈린다)는 다른 표다.
--
-- 백업: D:\tmp\timetable-plan-slots-backup-2026-10-23\rows.json (1,112행 · DB와 md5 대조 일치).
-- 되돌리기는 이 파일에 적지 않는다 — scripts/_oneoff/revert-0451a-drop-timetable-plan-slots.sql (표 다시 만들기)
-- + 백업 폴더의 restore.cjs (행 되살리기).
-- CASCADE를 붙이지 않는다 — 기댄 것이 생겼다면 조용히 같이 지우지 말고 여기서 멈춰야 한다.

drop table if exists public.timetable_plan_slots;

notify pgrst, 'reload schema';
