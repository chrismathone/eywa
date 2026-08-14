-- 0208a — 자리(랩실·JJ실) 출석부: 출결 기록에 **자리 표시** 한 칸.
--
-- 배경(원장 2026-08-14): *"랩실 출결도 시수로 잡아야함. **담임 시수로 잡히는게 아니라 별도 시수로
-- 잡힘.** 랩실 아르바이트 선생님이 출결 체크. 랩실 먼저 오픈."*
--
-- 랩실(603호)·JJ실(305호)은 사람이 아니라 **자리**이고, 같은 시각에 여러 반 학생이 함께 들어온다
-- (실측 랩실 최대 5개 반 32명). 자리 출석부는 **새 원장이 아니라 같은 데이터의 다른 축**이라
-- 출결은 종전대로 `attendance_records`에 (class_id = 학생의 원래 반, slot_start = 그 교시)로 쓴다.
--
-- 그런데 그렇게만 쓰면 그 시수가 **그 반 담임의 시수**로 합산된다(collectTierRows·settlement-queries가
-- 담임 반의 출결 시수를 그대로 더한다). 원장 지시는 정반대다 → 기록 자체에 "이건 자리 수업"이라는
-- 표시를 남기고, 담임 시수 집계에서 그 행을 뺀다. 자리 시수는 자리 축으로 따로 센다.
--
-- 🔴 왜 조인으로 파생하지 않고 컬럼에 굳히나: 자리 판정을 매번 `class_schedules`와 조인해 구하면
--    시간표에서 그 슬롯의 자리 라벨을 고치는 순간 **지난 달 급여가 소급해서 움직인다.** 돈은 기록
--    시점에 얼어야 한다 — 그래서 쓸 때 한 번 박고, 이후엔 그 값만 본다.
--
-- ⚠️ 이 파일은 **앱 배포보다 먼저** 실행해야 한다(gotchas #95). 자리 화면과 시수 집계가 이 컬럼을
--    읽으므로, 컬럼 없이 새 코드가 뜨면 그 경로가 PostgREST 400으로 죽는다. 반대로 이 SQL을 먼저
--    돌려 두면 **옛 코드에서도 아무 일도 안 일어난다**(아무도 안 읽고 안 쓰는 빈 칸일 뿐).
--
-- 멱등: add column if not exists + drop/create constraint + index if not exists.
-- 롤백: alter table attendance_records drop column seat_label;  (기록된 자리 표시가 사라진다 —
--       그러면 그 시수가 다시 담임 몫으로 합산되니, 롤백은 자리 출석부를 완전히 접을 때만.)

alter table attendance_records
  add column if not exists seat_label text;

comment on column attendance_records.seat_label is
  '자리 수업 표시 — LAB(랩실 603) · JJ(JJ실 305). null = 일반 수업(담임 시수). 자리 출석부가 쓸 때만 채운다. 담임 시수 집계는 이 값이 null인 행만 센다(0208a).';

-- 값 오염 방지 — 화면·액션이 자리 코드 두 개만 쓰므로 DB에서도 그 둘로 잠근다.
-- (자리를 새로 만들면 이 제약과 features/attendance/seat/seat.ts를 함께 넓힐 것.)
alter table attendance_records
  drop constraint if exists attendance_records_seat_label_check;
alter table attendance_records
  add constraint attendance_records_seat_label_check
  check (seat_label is null or seat_label in ('LAB', 'JJ'));

-- 자리 축 집계("이번 달 랩실 시수")용 부분 인덱스. 자리 행은 전체의 극히 일부라 부분 인덱스로 충분하고,
-- 담임 시수 집계(= seat_label is null)는 기존 (class_id, session_date) 경로를 그대로 탄다.
create index if not exists idx_attendance_seat_label
  on attendance_records (tenant_id, seat_label, session_date)
  where seat_label is not null;
