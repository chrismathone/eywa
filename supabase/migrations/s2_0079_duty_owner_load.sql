-- s2_0079 — 업무 완성도: 선생님마다 담당 반 수 · 담당 학생 수(집계) (2026-11-10)
--
-- 왜: 원장 2026-11-10 *"항상 선생님 이름 오른쪽에 '과목' 적을것"* · *"담당반 개수도"* · *"담당 학생 수도"*. 등급만으로는 한 반 맡은 사람과 열 반 맡은 사람이 같아 보인다.
-- 무엇: `duty_rollup_owner_load` — 고른 기간의 장부에서 담당자 × 과목마다 **반 수 · 학생 수**(겹침 없이). 집계 본문은 다른 집계와 같은 `duties_private.rollup_rows`
--   (같은 창 · 같은 과목 범위 · 같은 평가 개시 규칙 — 화면의 다른 숫자와 같은 모집단). 반 없는 의무(신규생 정착)는 반 수에 안 든다.
-- service_role 전용. 되돌리기: 이 함수를 지운다.
begin;

create or replace function public.duty_rollup_owner_load(p_tenant uuid, p_from date, p_to date, p_subjects text[], p_periods text[], p_owner uuid)
returns table (owner_id uuid, subject text, classes bigint, students bigint)
language sql stable security definer set search_path = public
as $fn$
  select r.owner_id, r.subject, count(distinct r.class_id), count(distinct r.student_id)
    from duties_private.rollup_rows(p_tenant, p_from, p_to, p_subjects, p_periods, p_owner) r
   group by r.owner_id, r.subject;
$fn$;

revoke all on function public.duty_rollup_owner_load(uuid, date, date, text[], text[], uuid) from public, anon, authenticated;
grant execute on function public.duty_rollup_owner_load(uuid, date, date, text[], text[], uuid) to service_role;

notify pgrst, 'reload schema';
commit;
