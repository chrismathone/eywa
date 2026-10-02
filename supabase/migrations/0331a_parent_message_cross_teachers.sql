-- 0331a — 학부모 출결 연락을 **다른 과목 담당 선생님**에게도 (원장 2026-10-02 김근호 건 *"체킹가능하게 배선해야할거같네"*)
--
-- 아버지가 영어 반 글에 "두통있어서 오늘학원쉽니다"를 달았는데 그날 수업은 수학이었다. 영어 보드는 영어 선생님만 보고,
-- 에이와의 학부모 글·댓글 벨은 같은 과목 담당에게만 간다 → 수학 선생님은 알 길이 없었다(반대 방향도 같다).
--
-- 이 칸에는 **그 학생의, 글이 올라온 보드 과목이 아닌 과목의 지금 담당 선생님** 계정 id 목록(jsonb 배열)을 연동 PC가 적는다
-- (계산 = scripts/_classnote/cross-subject-teachers.mjs — 담임·교시 담당·오늘 위임, 재검증·상한 가드 포함).
-- 앱은 그 연락을 **출결 연락으로 분류했을 때만** 이 사람들에게 출결 알림 벨을 넣는다(인사·감사 댓글은 가지 않는다).
--
-- 🔴 nullable이 의도다: null = 계산 안 함/대상 없음 → 종전대로 출결 알림을 켠 계정에게만 간다.
-- 🔴 앱·워커는 이 SQL 적용 전에도 돈다(#95) — 칸이 없으면 워커는 그 정보 없이 저장하고, 앱은 그 칸 없이 읽는다.
-- 이 표는 같은 지점 직원이 읽는 표다(0184a) — 계정 id 목록은 민감 정보가 아니다(담당 배정은 시간표에 이미 보인다).
alter table public.classnote_parent_messages
  add column if not exists cross_teacher_ids jsonb;

comment on column public.classnote_parent_messages.cross_teacher_ids is
  '이 연락을 출결 연락으로 분류했을 때 함께 알릴 다른 과목 지금 담당 선생님(users.id jsonb 배열). null = 대상 없음.';

notify pgrst, 'reload schema';
