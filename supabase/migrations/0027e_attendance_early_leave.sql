-- 0027e: 출결 상태 enum에 '조퇴'(early_leave) 추가 (손수 alpha)
-- 조퇴는 학원 일상에서 흔한 상태인데 present/absent/late/excused/makeup에 없어 표현 불가였음(P1).
-- ALTER TYPE ADD VALUE는 트랜잭션 밖에서 실행(멱등).
alter type public.attendance_status add value if not exists 'early_leave';
