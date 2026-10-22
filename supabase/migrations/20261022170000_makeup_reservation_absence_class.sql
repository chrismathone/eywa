-- 보강 예약 — **기록할 반**을 고른다(원장 2026-10-22 *"보강 예약에도 기록할 반 고르기를 넣자"* · *"이전 보강은 됐고, 앞으로 보강에는"*).
--
-- '+ 보강 학생 추가'는 09-21부터 "어느 수업에 기록할까요?"를 묻는다(학생이 다니는 열린 반 중에서). 예약은 결석난 반에 고정이라
-- 반을 옮긴 학생의 예약이 이미 닫힌 반에 잡혔다(전주율 10/29 — JJ2B, 10/18 수강 종료).
--
-- 🔑 칸의 뜻:
--   · `class_id` = **기록할 반**(보강이 서는 반) — 원스크린·출석부·시간표 보강 탭·운영실 카드·보강관리 연동이 이미 이렇게 읽는다(바뀌는 곳 없음).
--   · `absence_class_id`(새 칸) = **결석난 반** — 결석일 칸(결석 0 · "M/D 보강 예정" 메모)을 쓰고 되돌리는 곳만 읽는다.
--     null = `class_id`와 같다(이 칸 전의 예약 전부 · 같은 반에 잡은 예약). 앱은 `absenceClassOf(r)` 한 곳으로 읽는다.
-- 옛 예약은 손대지 않는다(원장 *"이전 보강은 됐고"*).
--
-- ⚠️ 앱은 이 SQL 적용 **뒤에** 배포한다([[#95]]). 이 칸을 읽는 조회(예약 단건·이행)는 칸이 없으면 칸 없이 다시 읽는다.
set local statement_timeout = '60s';

alter table public.makeup_reservations
  add column if not exists absence_class_id uuid references public.classes(id) on delete cascade;

comment on column public.makeup_reservations.absence_class_id is
  '결석난 반 — 결석일 칸(결석 0·보강 예정 메모)의 반. null = class_id(기록할 반)와 같다';
