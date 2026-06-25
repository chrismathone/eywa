-- 강사 퍼스널 색(시간표 강사 헤더 밴드) — ijw Teacher.bgColor/textColor 패리티.
-- eywa는 반(classes) 색만 있고 강사 색이 없어 시간표 익스포터의 강사 헤더가 해시색이었다.
-- 직원관리 편집에서 강사별 색을 설정하면 ijw와 동일하게 강사 헤더 밴드가 그 색으로 나온다.
alter table public.users add column if not exists bg_color text;
alter table public.users add column if not exists text_color text;
