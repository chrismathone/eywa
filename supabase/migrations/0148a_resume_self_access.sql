-- 0148a_resume_self_access.sql (손수 alpha)
-- 본인 이력서 자기수정(원장 지시 2026-07-29) — 직원이 로그인해 **자기 이력서만** 열람·수정한다.
-- 0072a의 restrictive 가드는 restricted 행을 사무실 역할로만 한정해, 강사·뷰어는 자기 이력서 행조차 못 봤다.
-- staff_user_id(0147a)로 연결된 본인을 예외로 추가한다. 앱 레이어(canViewResume)가 진짜 게이트이고
-- 이건 거친 백스톱이라, 여기서 열어도 남의 이력서는 앱·DB 양쪽에서 여전히 막힌다(staff_user_id ≠ auth.uid()).

drop policy if exists academy_documents_restricted_guard on academy_documents;
create policy academy_documents_restricted_guard on academy_documents
  as restrictive
  for all
  using (
    restricted is not true
    or (select public.auth_system_role()) in ('master', 'admin', 'manager', 'accountant')
    or staff_user_id = (select auth.uid())
  );
