-- 0224a: 직원 '강사뷰 접근' 토글 — '다른 강사 뷰'(열람 전용) 자격 (원장 2026-08-19)
--
-- 관리자가 로그인 없이 특정 강사의 강사뷰를 열람하는 기능의 자격 컬럼.
-- master·super_admin은 컬럼과 무관하게 통과(canUseOtherTeacherView) — 이 토글은 그 외 직원용.
-- 편집은 직원관리 수정 폼에서 master(+super_admin)만. 앱은 컬럼 부재를 fail-soft로 견딘다(#95):
-- SQL 적용 전에도 master는 기능을 쓰고, 토글 사용자만 적용 후 열린다.

alter table public.users
  add column if not exists teacher_view_access boolean not null default false;

comment on column public.users.teacher_view_access is
  '다른 강사의 강사뷰 열람(열람 전용) 허용 — master·super_admin은 컬럼 무관 통과 (0224a)';
