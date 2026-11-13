-- s2_0089 — 업무 완성도: 선생님별 수업보고서 평점 평균 (2026-11-11)
--
-- 왜: 원장 2026-11-11 *"수업보고서와 상담의 평점을 반영할 수 있는 방안도 모색할것"* → *"진행"*. 제때 보냈어도 내용이 빈 보고서가 '업무 완료'로만 보였다
--   (10월 이후 평균 1.1점인 선생님도 준수율은 높다). 준수율 · 등급에는 섞지 않고, 선생님 표에 **별도 열**로 붙인다(평점은 참고용 값 — 0450a).
-- 무엇: `duty_report_rating_by_owner` — 작성자 × 과목마다 그 기간(보고서 날짜) 평점 수 · 평균. 지금 기준(p_rubric)으로 매긴 줄만 · 회수한 보고서 제외.
--   합계는 DB에서(B2 — 한 달 1,700줄을 화면 서버로 끌어오지 않는다). 상담 평점은 그 표에 값이 쌓이면 같은 모양으로 더한다.
-- 연동 역할 실행권 확인: 새 함수 — 관리 화면(앱 service_role)만 부른다.
-- 되돌리기: 이 함수를 지운다(앱은 함수가 없으면 평점 열 없이 뜬다).
begin;

create or replace function public.duty_report_rating_by_owner(p_tenant uuid, p_from date, p_to date, p_rubric text, p_subjects text[])
returns table (owner_id uuid, subject text, rated bigint, avg_points numeric)
language sql stable security definer set search_path = public
as $fn$
  select r.created_by, c.subject, count(*), round(avg(g.points), 2)
    from public.lesson_report_ratings g
    join public.lesson_reports r on r.id = g.report_id and r.tenant_id = p_tenant
    left join public.classes c on c.id = r.class_id and c.tenant_id = p_tenant
   where g.tenant_id = p_tenant and g.rubric = p_rubric
     and r.report_date between p_from and p_to
     and r.revoked_at is null and r.created_by is not null
     and (p_subjects is null or c.subject = any(p_subjects))
   group by r.created_by, c.subject;
$fn$;

revoke all on function public.duty_report_rating_by_owner(uuid, date, date, text, text[]) from public, anon, authenticated;
grant execute on function public.duty_report_rating_by_owner(uuid, date, date, text, text[]) to service_role;

commit;
