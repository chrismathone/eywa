-- s2_0022 — 원생 보호자2(이름·연락처·관계) 칸 (2026-11-04) — ✅ 운영 적용 2026-11-04 15:05 · CLI(원장 승인)
-- 번호: 적용 때는 임시 번호 s2_0024였고, main에 합치며 다음 빈 번호 s2_0022로 옮겼다(docs/sql-season2.md §D). 본문은 적용한 글자 그대로다 —
--   아래 칸 설명(comment on column)의 "(s2_0024)"도 운영 DB 칸 설명과 같게 두려고 일부러 고치지 않았다.
--
-- 왜: 원장 *"메이크에듀가 아니라 에이와"* · *"여기서해서 올려 그냥"* — 원생 수정 화면 '보호자 연락처'에 보호자를 한 명 더 적게.
--     계기: 전유솔은 ClassNote 보호자1이 어머니 번호인데 에이와에는 아버지 번호만 있어 반 보드 자동 배정이 '보호자 전화 불일치'로 막혔다.
-- 무엇: public.students에 nullable text 칸 셋(parent2_name · parent2_phone · parent2_relation)만 더한다. 기본값·제약·색인 없음 —
--       기존 줄은 null 그대로이고, 기본값 없는 nullable 칸 추가는 표를 다시 쓰지 않는다(카탈로그만 바뀐다).
--   · 활동 로그 트리거(log_activity)는 칸을 일반으로 비교해 바뀐 값을 그대로 남긴다 — 화면 이름표는 앱(`src/features/audit/activity.ts`).
--   · 권한은 표 단위(로그인 사용자·연동 PC 역할 eywa_sync_agent)라 새 칸도 그대로 읽힌다 — 칸 단위 권한 없음(운영 실측 2026-11-04).
--   · 콜&상담 자동 연결(trg_link_consultation_on_student · eywa_cs_match_rule)은 이 칸을 보지 않는다 — 따로 진행 중인 SQL 작업 몫.
-- 운영 실측(2026-11-04 읽기 전용): students 1,028행 · 2.3MB · 이 표에 기대는 뷰 없음 · parent2_* 이름의 칸 없음.
-- 잠금: students는 매일 쓰는 표 — 칸 추가 자체는 순간이지만 잠금(ACCESS EXCLUSIVE)을 기다리는 동안 뒤의 쓰기가 줄을 선다 →
--   lock_timeout 3초(못 잡으면 실패 — 다시 실행). `set local`이라 이 트랜잭션에만 걸린다.
-- 적용 순서: 🔴 웹 배포 **전에**([[#95]]) — 웹이 원생 상세·수정·목록 검색·형제·중복 후보에서 이 칸을 읽는다(없으면 그 화면이 400으로 죽는다).
--   그다음 AywaSync(ClassNote 워커 — 원아 전화 대조에 parent2_phone을 더한 판)를 게시한다. 질의 목록은 웹과 함께 나간다.
-- 적용 확인(읽기만):
--   select count(*) from information_schema.columns
--    where table_schema = 'public' and table_name = 'students'
--      and column_name in ('parent2_name', 'parent2_phone', 'parent2_relation');   -- 기대: 3
--
-- 되돌리기: scripts/_oneoff/revert-s2_0022-student-guardian2.sql (웹·AywaSync를 먼저 되돌린 뒤)

begin;
set local lock_timeout = '3s';

alter table public.students
  add column if not exists parent2_name text,
  add column if not exists parent2_phone text,
  add column if not exists parent2_relation text;

comment on column public.students.parent2_name is '보호자2 이름 — 원생 수정 화면 보호자 연락처의 둘째 줄(s2_0024)';
comment on column public.students.parent2_phone is '보호자2 연락처 — 같은 사람 대조(형제·중복 후보·ClassNote 원아)에 보호자1 연락처와 함께 쓴다(s2_0024)';
comment on column public.students.parent2_relation is '보호자2 관계 — 보호자1과 같은 목록(부·모·조부·조모·기타, s2_0024)';

notify pgrst, 'reload schema';

commit;
