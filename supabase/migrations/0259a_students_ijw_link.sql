-- 0259a — eywa 학생 ↔ MemoType(인재원 SRS, D:\anki-main) 학생 **짝** 한 칸
--
-- 사용자 2026-09-10: 영어 단어시험·평소 학습 데이터는 MemoType이 갖고 있고, eywa는 **필요할 때 API로 요청**한다
-- (같은 날 폐기된 안: anki가 eywa DB로 밀어넣기 → eywa에 받는 입구·JJ 저장 표를 만들지 않는다).
-- 그래서 eywa에 남는 저장은 이 **짝 하나**다 — "이 eywa 학생이 MemoType의 누구인가".
-- 성적관리 'JJ실'·'JJ실(시험)'과 학생 상세 '성적' 탭, 영어 보고서 카드의 결과지가 이 짝으로 MemoType에 묻는다.
--
-- 🔑 값 = MemoType `User.id`(ijwId). anki 쪽 확인(2026-09-10): 학생 이름을 바꿔도 id는 그대로이고
--    화면에 보일 이름은 응답의 `name`이다 → 짝은 이름이 바뀌어도 안 끊긴다.
-- 🔴 이름으로 자동 연결하지 않는다 — MemoType엔 생년월일·학교가 없어 동명이인을 못 가른다.
--    관리자가 한 번 확정한다(makeedu_id·edutrix_student_id 선례). 연결 경로는 서버 액션 하나이고 감사로그를 남긴다.
-- 🔴 유니크 인덱스에 WHERE를 붙이지 않는다([[#113]]) — NULL은 원래 서로 안 겹친다.
--    막는 것은 "한 MemoType 학생이 eywa 학생 둘에 붙는 것" 하나다.
-- ⚠️ 앱은 이 컬럼이 **없어도 돌아간다**([[#95]]) — 짝을 읽는 곳은 컬럼 부재를 "짝 없음"으로 읽고,
--    연결 버튼만 "준비 중"이라고 말한다.
-- ⚠️ 번호: 처음엔 0254a였으나 같은 날 main에 다른 작업의 마이그레이션이 먼저 들어가 뒤로 옮겼다(번호는 병합 직전에 확정).
--
-- 롤백:
--   drop index if exists public.students_tenant_ijw_student_id_uniq;
--   alter table public.students drop column if exists ijw_student_id;
set local statement_timeout = '60s';

alter table public.students
  add column if not exists ijw_student_id text;

comment on column public.students.ijw_student_id is
  'MemoType(인재원 SRS) User.id — 이 학생의 단어시험·학습 데이터를 MemoType API에 묻는 짝. 관리자가 확정(이름 자동 연결 금지). 0259a';

create unique index if not exists students_tenant_ijw_student_id_uniq
  on public.students (tenant_id, ijw_student_id);

notify pgrst, 'reload schema';
