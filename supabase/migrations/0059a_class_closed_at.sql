-- 종강(class term end): is_active(폐지)와 별개의 '운영 종료일'.
-- closed_at != null = 종강 → 시간표 타임머신에서 그 날짜 이전 주엔 표시(수강이력 보존), 종강일 이후 주에서만 숨김.
-- (폐지 = is_active=false 는 전체 주에서 숨김. 종강은 is_active=true 를 유지해 과거 주에 남는다.)
alter table classes add column if not exists closed_at date;
