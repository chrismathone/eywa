-- s2_0024 되돌리기 — 원생 보호자2 칸 셋을 지운다.
-- 🔴 적어 둔 보호자2 값이 함께 사라진다. 필요하면 먼저 받아 둘 것(읽기만):
--   select id, name, parent2_name, parent2_phone, parent2_relation from public.students
--    where coalesce(parent2_name, parent2_phone, parent2_relation) is not null;
-- 🔴 웹과 AywaSync(ClassNote 워커)를 이 칸을 읽지 않는 판으로 **먼저** 되돌린 뒤에 실행한다 — 그 전에 지우면 원생 상세·수정·검색과
--   워커의 원아 전화 대조 질의가 칸이 없어 실패한다([[#95]]).
-- 잠금: 매일 쓰는 표라 lock_timeout 3초(못 잡으면 실패 — 다시 실행).

begin;
set local lock_timeout = '3s';

alter table public.students
  drop column if exists parent2_relation,
  drop column if exists parent2_phone,
  drop column if exists parent2_name;

notify pgrst, 'reload schema';

commit;
