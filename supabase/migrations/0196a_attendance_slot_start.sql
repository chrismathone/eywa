-- 0196a — 출결을 **교시 단위**로 적을 수 있게 (`attendance_records.slot_start`)
--
-- 원장 2026-08-10: *"ecs에서 아래쪽에 같은 학생이 있으면 위쪽에서 출석 골랐을때 아래쪽도 자동으로
-- 출석되는거 버그 수정해."*
--
-- 원인은 렌더링이 아니라 **스키마**였다. `attendance_records`의 사실상 키가 (반, 학생, **날짜**)라
-- 하루 1건뿐이고, ECS의 4교시·6교시 카드는 그 한 행을 **같이 비추고** 있었다(그래서 한쪽을 고르면
-- 다른 쪽도 같이 바뀐다). 교시를 구분하려면 행이 교시를 알아야 한다.
--
-- 이 마이그레이션은 **칼럼만 추가한다(순수 가산)**:
--   · 기존 행은 전부 `slot_start = null` = "그날 전체"(지금까지의 의미 그대로).
--   · 아직 **아무 코드도 이 칼럼을 읽지 않는다** → 적용해도 화면 동작이 하나도 안 바뀐다.
-- 🔴 이렇게 쪼갠 이유: eywa는 SQL을 사람이 손으로 돌리므로 **앱보다 스키마가 먼저** 있어야 한다.
--    반대로 하면 새 칼럼을 읽는 앱이 먼저 떠서 강사 화면이 통째로 죽는다(2026-08-03 실사고, [[#95]]).
--    읽기·쓰기(교시별 dedup RPC·ECS 배선)는 이 파일이 적용된 걸 확인한 뒤 별도 커밋으로 올린다.
--
-- ⚠️ `time` (timezone 없음) — `class_schedules.start_time`과 같은 타입이라 비교가 캐스팅 없이 된다.
-- ⚠️ NOT NULL로 만들지 않는다. 기존 20만 행을 뭘로 채울지는 **데이터로 답이 안 나오는** 질문이고
--    (그 날 2교시였다면 어느 쪽이었는지 기록이 없다), 억지 백필은 없는 사실을 만든다. null = "그날 전체".
-- ⚠️ 유니크 제약을 걸지 않는다 — 이 테이블은 정정을 새 행으로 쌓는 append-only(supersedes_id)라
--    (반·학생·날짜)조차 유니크가 아니다. '유효 1건'은 recorded_at 최신으로 고른다(distinct on).
--
-- 롤백: alter table attendance_records drop column slot_start;
set local statement_timeout = '60s';

alter table public.attendance_records
  add column if not exists slot_start time;

comment on column public.attendance_records.slot_start is
  '이 출결이 가리키는 교시 시작 시각(class_schedules.start_time와 같은 값). null = 그날 전체(2026-08-10 이전 기록과 교시 구분이 없는 화면의 기본). 같은 (반·학생·날짜)에 교시가 둘 이상이면 교시마다 한 행.';

-- 조회는 언제나 (테넌트·반·날짜)로 좁힌 뒤 교시를 가르므로 기존 인덱스 뒤에 교시를 덧댄다.
-- (attendance_class_date_idx = (tenant_id, class_id, session_date) — 그걸 대체하지 않고 보완한다.)
create index if not exists attendance_class_date_slot_idx
  on public.attendance_records (tenant_id, class_id, session_date, slot_start);

notify pgrst, 'reload schema';
