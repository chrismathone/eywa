-- 0316a: 출결 한 칸의 **대신 보강 귀속 강사** — attendance_records.taught_by.
--
-- 원장 결정(2026-09-30):
--  · 위임 없이 남의 반 학생을 대신 보강하면 보고서·출석부 반은 **학생의 원래 반(B반)**이다(보고서 반 = 출석부 반 = 발송 반).
--  · 그 칸의 시수(월별 출석부·정산·강사 보기)는 **실제로 보강한 강사(A)** 몫이다.
-- 반 축(class_id)을 B반에 두면서 귀속만 A로 돌리는 표식이 이 칸이다. 보강 보고서 저장 훅이
-- **보강한 강사가 그 반을 담당(담임 ∪ 위임)하지 않을 때만** 적는다 — 나머지 행은 전부 NULL(종전 축 그대로:
-- 교시 담당 → 담임, src/features/attendance/teacher-axis.ts).
--
-- ⚠️ recorded_by(입력한 사람)와 다르다 — 데스크가 대신 찍어도 귀속은 안 바뀐다.
-- ⚠️ 앱은 이 칸이 없어도 돈다([[#95]]): 읽는 곳은 probe 뒤 따로 읽고, 쓰는 곳은 칸이 없으면 귀속만 빼고 저장한다.
--    원스크린 로스터(핫패스)의 select에는 넣지 않는다.
-- 멱등: add column if not exists · index if not exists.

alter table public.attendance_records
  add column if not exists taught_by uuid references public.users(id) on delete set null;

comment on column public.attendance_records.taught_by is
  '대신 보강 귀속 강사(원장 2026-09-30) — 이 칸의 시수를 실제로 가르친 강사 몫으로 센다. NULL = 종전 축(교시 담당 → 담임). '
  '보강 보고서 저장 훅이 보강한 강사가 그 반을 담당하지 않을 때만 적는다. recorded_by(입력자)와 다르다.';

-- 강사 한 명의 그 달 대신 보강 칸(정산·강사 보기) — 대부분 NULL이라 부분 인덱스로 작게.
create index if not exists attendance_records_taught_by_idx
  on public.attendance_records (tenant_id, taught_by, session_date)
  where taught_by is not null;

notify pgrst, 'reload schema';
