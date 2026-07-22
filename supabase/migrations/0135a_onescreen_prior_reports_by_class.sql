-- 0135a: onescreen_prior_reports를 **반(수업) 단위**로 — 0134a(보고서 1건 = 반 1개)의 짝.
--
-- 왜: 0117a는 (학생, 과목)별 직전 1건을 돌려준다. 보고서가 반 단위가 된 뒤 이 규약을 그대로 두면
--     같은 과목 두 행(정규 수학·수학 특강)이 **같은 이전 회차**를 받는다 →
--     특강 행의 '이전 회차 참고'와 교재 승계에 정규 수업 진도가 뜬다(강사가 그걸 그대로 가져다 쓴다).
--
-- 단위 키는 0134a의 생성열과 **같은 식**이다: coalesce(class_id::text, subject).
--   · 반이 있으면 그 반의 직전 회차
--   · 반이 없으면(이관분·보강) 과목 단위 — 예전과 동일
--   · 둘 다 없으면 NULL 하나로 묶여 학생당 1건(이관분 폴백) — 이전과 사실상 같은 동작
-- ⚠️ 앱측 미러 = src/features/onescreen/report-unit.ts `reportUnitKey`. 셋(DB 생성열·이 RPC·앱)이 같은 식이어야 한다.
--
-- 반환에 class_id를 추가한다 — 로스터가 어느 행에 붙일지 고르는 키다(과목만으론 두 행을 못 가른다).
-- ⚠️ 반환 컬럼이 늘어나므로 **함수를 먼저 drop**한다(create or replace는 시그니처/반환형 변경을 거부한다).
-- security invoker + auth_tenant_id() 이중격리(0039a/0040a 패턴)는 그대로.
--
-- 롤백 = 0117a 정의를 그대로 다시 실행(그 파일이 원본).

drop function if exists onescreen_prior_reports(uuid[], date);

create function onescreen_prior_reports(p_student_ids uuid[], p_before date)
returns table (
  student_id uuid,
  subject text,
  class_id uuid,
  report_date date,
  progress text,
  exam_info text,
  textbook text,
  homework_today text,
  homework_score text,
  attitude text,
  notes text
)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct on (r.student_id, coalesce(r.class_id::text, r.subject))
    r.student_id, r.subject, r.class_id, r.report_date, r.progress,
    r.exam_info, r.textbook, r.homework_today, r.homework_score,
    r.attitude, r.notes
  from lesson_reports r
  where r.tenant_id = auth_tenant_id()
    and r.student_id = any(p_student_ids)
    and r.report_date < p_before
  -- id desc = 같은 날 2건일 때 결정적 선택(0117a엔 없어 비결정적이었다).
  order by r.student_id, coalesce(r.class_id::text, r.subject), r.report_date desc, r.id desc
$$;
