-- 0152a: onescreen_prior_reports에 **최근 진도 후보 배열**(recent_progress) 추가 — "진도가 중단된 날" 대응.
--
-- 왜: 0135a는 (학생, 반|과목)별 **직전 1건**만 돌려준다. 그런데 시험을 치는 날(월말평가·모의고사·내신대비·
--     시험대비, src/features/onescreen/progress-status.ts)은 나간 차시가 없어 진도칸에 상태 라벨만 저장된다.
--     그러면 **다음 회차의 '이전 진도'가 "월말평가"로 덮여** 강사가 "어디까지 나갔더라"를 볼 단서를 잃는다
--     (원장 2026-07-28: *"그 날은 시험을 치기 때문에 진도가 '중단'되는 날"* → 진도 시계는 그 전 차시를 가리켜야 한다).
--
-- 어떻게: 같은 단위(unit_key)의 **최근 진도 5건을 최신순 배열로** 함께 돌려준다. 어느 것이 "시험 회차"인지는
--     **앱이 판정**한다(progress-status.ts `isSkipStatusProgress`) — 🔴 상태 라벨 목록을 SQL에 복제하지 않기
--     위해서다. 목록이 두 곳에 살면 한쪽만 고쳐져 조용히 어긋난다(라벨 추가 시 SQL만 옛 목록으로 남음).
--     앱은 배열에서 **시험 회차가 아닌 첫 값**을 골라 '이전 진도'로 쓴다. 5건이 전부 시험이면 폴백 = 기존 동작.
--
-- ⚠️ 직전 회차 자체(progress·textbook·exam_info…)는 **그대로 둔다** — 표 뷰 '이전 회차 참고행'과 교재 승계는
--    실제 직전 회차가 사실이다(그날이 월말평가면 참고행엔 월말평가가 떠야 맞다). 바뀌는 건 '이전 진도' 한 줄뿐.
-- ⚠️ 반환 컬럼이 늘어나므로 **함수를 먼저 drop**한다(create or replace는 반환형 변경을 거부한다).
-- security invoker + auth_tenant_id() 이중격리(0039a/0040a 패턴)는 그대로 — lateral 안에서도 tenant를 다시 건다.
--
-- 롤백 = 0135a 정의를 그대로 다시 실행(그 파일이 직전 원본). 앱은 recent_progress가 없으면 기존 동작으로 떨어진다.

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
  notes text,
  recent_progress text[]
)
language sql
stable
security invoker
set search_path = public
as $$
  with prior as (
    select distinct on (r.student_id, coalesce(r.class_id::text, r.subject))
      r.student_id, r.subject, r.class_id, r.report_date, r.progress,
      r.exam_info, r.textbook, r.homework_today, r.homework_score,
      r.attitude, r.notes,
      coalesce(r.class_id::text, r.subject) as unit_key
    from lesson_reports r
    where r.tenant_id = auth_tenant_id()
      and r.student_id = any(p_student_ids)
      and r.report_date < p_before
    -- id desc = 같은 날 2건일 때 결정적 선택(0117a엔 없어 비결정적이었다).
    order by r.student_id, coalesce(r.class_id::text, r.subject), r.report_date desc, r.id desc
  )
  select p.student_id, p.subject, p.class_id, p.report_date, p.progress,
         p.exam_info, p.textbook, p.homework_today, p.homework_score,
         p.attitude, p.notes,
         c.recent_progress
  from prior p
  left join lateral (
    -- 같은 단위의 최근 진도 5건(최신순). 5인 이유: 시험이 연달아 5회면 그냥 직전 값을 쓰는 게 낫다(무한 소급 방지).
    -- ⚠️ array_agg의 order by를 생략하지 말 것 — 서브쿼리 ORDER BY만으로는 집계 순서가 보장되지 않는다.
    select array_agg(x.progress order by x.report_date desc, x.id desc) as recent_progress
    from (
      select r2.progress, r2.report_date, r2.id
      from lesson_reports r2
      where r2.tenant_id = auth_tenant_id()
        and r2.student_id = p.student_id
        and coalesce(r2.class_id::text, r2.subject) is not distinct from p.unit_key
        and r2.report_date < p_before
        and r2.progress is not null
        and btrim(r2.progress) <> ''
      order by r2.report_date desc, r2.id desc
      limit 5
    ) x
  ) c on true
$$;
