-- 0044a — 강사 인수인계(담임 교체 예약). 손수 alpha 파일. 전부 멱등.
-- ijw TeacherHandover 이식(경량판): classes에 예정 강사·적용일·사유 3컬럼.
--   · pending_teacher_id   = 인계받을 강사(users FK). NULL=예약 없음.
--   · pending_teacher_date = 적용 예정일(date).
--   · pending_teacher_reason = 사유 메모(text).
-- 적용 시 teacher_id ← pending_teacher_id로 교체하고 3컬럼 비움(applyHandover 액션).
-- ⚠️ ijw의 enrollment eager-split·배치 롤백·자동적용은 미이식(데모 과중) — 예약/적용/취소 UX만.
-- RLS는 classes 테이블 정책(0001a) 그대로 상속(컬럼 추가만). drizzle migrate 대신 raw 적용.

begin;

alter table public.classes
  add column if not exists pending_teacher_id uuid references public.users(id) on delete set null;
alter table public.classes
  add column if not exists pending_teacher_date date;
alter table public.classes
  add column if not exists pending_teacher_reason text;

commit;
