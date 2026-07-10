-- 0096a: lesson_reports 오늘 과제(homework_today) — edutrix 강사 필드 패리티 마지막 조각.
-- 배경(2026-07-10): edutrix 폼의 '오늘 과제'(집에서 할 숙제 내용, 사용률 90%=15,222/16,877)가 eywa엔
-- 없었음 — eywa '과제'는 수행 상태(완료/미흡/미제출)만. AI 학부모 멘트 프롬프트는 "오늘 과제는 ~입니다"로
-- 끝내라고 지시하는데 재료 칸이 없던 불일치도 함께 해소. 학부모 카드 표시는 설정 토글 showHomeworkToday.
-- 이력 백필 = scripts/_edutrix_retire/full-import-reports.cjs 재실행(Edutrix homework_today → 동명 컬럼).
alter table lesson_reports add column if not exists homework_today text;

comment on column public.lesson_reports.homework_today is
  '오늘 내준 과제(숙제) 내용 — edutrix homework_today 패리티. homework_score(수행 상태)와 별개.';
