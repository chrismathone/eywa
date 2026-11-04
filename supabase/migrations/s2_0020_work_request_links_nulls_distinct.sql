-- s2_0020 — 업무 요청 근거 학생 연결: 담당 미정(null) 줄의 유일 조건 풀기 (2026-11-03)
--
-- 왜: 적대적 리뷰(2026-11-03) — `work_request_links_uniq`가 `unique nulls not distinct (request_id, target_type, target_id, assignee_id)`라,
--     같은 요청에서 한 학생을 맡은 두 담당자(과목이 다른 두 담임)를 둘 다 지우면 두 번째 직원 삭제가 23505로 실패한다
--     (`assignee_id … on delete set null`이 (학생, null) 줄을 두 개 만든다). 직원 삭제는 로그인 계정을 먼저 지우므로 직원 행만 반쯤 남는다.
-- 고침: 담당 미정(null) 줄끼리는 겹쳐도 되게 — 일반 유일 조건(null끼리는 서로 다르다). 담당자가 있는 줄의 중복은 그대로 막는다.
--     만들기 함수는 한 번에 넣는 줄을 `select distinct`로 이미 거르고, 앱은 다른 담당자가 맡은 학생의 미정 줄을 보내지 않는다(`effectiveStudents`).
-- 🔴 이 기능 전용 표 하나의 제약만 바꾼다. 기존 2.0 표·함수는 건드리지 않는다. 앱은 이 SQL이 없어도 그대로 돈다(순서 무관).

begin;

alter table public.work_request_links drop constraint if exists work_request_links_uniq;
alter table public.work_request_links add constraint work_request_links_uniq unique (request_id, target_type, target_id, assignee_id);

commit;
