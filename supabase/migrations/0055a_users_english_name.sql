-- 0055a: users.english_name — 강사 영문 닉네임(ijw staff.englishName).
-- 영어 시간표 슬롯 라벨이 영문닉네임("Kristine"·"Hannah")이라, 통합뷰에서 라벨→저장된 강사색을
-- 해결하려면 users에 영문명이 있어야 한다(display_name=한글로는 매칭 불가). RLS는 users 정책 그대로.
alter table users add column if not exists english_name text;
