-- 0027f: 학생 프로필 필드 확장 (손수 alpha)
-- 영문명·성별·생년월일·주소·이메일이 컬럼 자체가 없어 학원 핵심 식별/연락 정보가 빈약했음(P1).
-- student_phone은 kiosk(0027)에서 이미 추가됨. 추가 컬럼이라 무손실.
alter table public.students add column if not exists english_name text;
alter table public.students add column if not exists gender text;
alter table public.students add column if not exists birth_date date;
alter table public.students add column if not exists address text;
alter table public.students add column if not exists email text;
