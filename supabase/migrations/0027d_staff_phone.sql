-- 0027d: users(직원)에 연락처 phone 컬럼 추가 (손수 alpha)
-- 직원 연락처가 시스템에 없어 급히 연락할 때 못 찾던 갭(P1). 추가 컬럼이라 무손실.
alter table public.users
  add column if not exists phone text;
