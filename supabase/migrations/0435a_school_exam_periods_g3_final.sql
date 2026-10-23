-- 학교별 내신기간 — **중3 2학기 기말**을 따로 적을 수 있게(적대적 리뷰 2026-10-20).
-- 기본표부터 중2(11/1~12/10)와 중3(10/1~11/10)의 2학기 기말 날짜가 다른데 칸이 하나라, 중3 날짜를 적으면
-- 같은 학교 중2 학생이 10월에 진도를 멈추고 진짜 11~12월 시험은 빠지지 않았다. `2-final-3`을 허용한다.
-- 멱등 — 제약을 지우고 다시 건다(값이 늘기만 해 기존 행은 그대로 통과한다).
set local statement_timeout = '60s';

alter table public.school_exam_periods drop constraint if exists school_exam_periods_term_check;
alter table public.school_exam_periods add constraint school_exam_periods_term_check
  check (term in ('1-mid', '1-final', '2-mid', '2-final', '2-final-3'));

notify pgrst, 'reload schema';
