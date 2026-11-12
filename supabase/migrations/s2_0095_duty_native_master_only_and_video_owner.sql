-- s2_0095 — '원어민 선생님'은 원장만 바꾼다 · 영상 숙제 낸 사람 = 영상 제출 현황의 '내가 낸 숙제'와 같게 (2026-11-12 · s2_0094 리뷰 반영)
--
-- 왜:
--   · s2_0094의 users.native_teacher는 직원관리 권한자면 누구나(본인 행 포함) 바꿀 수 있었다(가드 트리거 ①번 분기가 칸을 가리지 않는다) —
--     켜면 업무 완성도 집계에서 통째로 빠지니, 관리자 겸 강사가 자기 평가를 끌 수 있다. '강사뷰 접근'(teacher_view_access)과 같은 결로 원장(+운영자)만.
--     기존 가드 함수(시즌1 guard_user_privilege_columns)는 그대로 두고 이 칸만 보는 작은 트리거를 더한다.
--   · duty_video_homework_rollup의 낸 사람을 영상 숙제 장부(`own-homework.ts`)와 같게: 보고서 = 작성 계정(`created_by`)만 · 따로 낸 숙제 = `teacher_id`만.
--     지금 담임으로 메우지 않는다(지난 날은 그날 사람 — 모르면 세지 않는다) · 한 칸을 보고서 작성자와 따로 낸 선생님이 둘 다 냈으면 둘 다 센다(장부도 두 사람 칸).
-- 실행권: 그대로(service_role만).

begin;

create or replace function public.guard_user_native_teacher() returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $fn$
begin
  if new.native_teacher is not distinct from old.native_teacher or auth.uid() is null then
    return new;
  end if;
  if coalesce(public.auth_system_role(), '') = 'master' or coalesce(public.is_super_admin(auth.uid()), false) then
    return new;
  end if;
  raise exception '''원어민 선생님''은 원장만 바꿀 수 있습니다' using errcode = '42501';
end;
$fn$;
revoke all on function public.guard_user_native_teacher() from public, anon, authenticated;

drop trigger if exists tg_guard_user_native_teacher on public.users;
create trigger tg_guard_user_native_teacher
  before update of native_teacher on public.users
  for each row execute function public.guard_user_native_teacher();

create or replace function public.duty_video_homework_rollup(p_tenant uuid, p_from date, p_to date, p_subjects text[], p_owner uuid)
returns table (owner_id uuid, subject text, issued int, judged int, collected int)
language sql stable security definer set search_path = public
as $fn$
  with issued as (
    -- 낸 사람마다 한 칸(같은 사람이 보고서와 따로 낸 숙제로 두 번 냈으면 한 번 · 마감은 보고서 것이 먼저).
    select distinct on (h.class_id, h.student_id, h.homework_date, h.owner_id) h.class_id, h.student_id, h.homework_date, h.owner_id, h.due
      from (
        select r.class_id, r.student_id, r.report_date as homework_date, r.created_by as owner_id,
               coalesce(r.video_homework_due, r.report_date + 7) as due, 0 as pri
          from public.lesson_reports r
         where r.tenant_id = p_tenant and r.video_homework = true and r.class_id is not null and r.created_by is not null
           and r.report_date between p_from and p_to
        union all
        select e.class_id, e.student_id, e.homework_date, e.teacher_id, e.homework_date + 7, 1
          from public.video_homework_extra_issues e
         where e.tenant_id = p_tenant and not e.kept and e.teacher_id is not null and e.homework_date between p_from and p_to
      ) h
      join public.students st on st.id = h.student_id and st.tenant_id = p_tenant and not st.is_test
     order by h.class_id, h.student_id, h.homework_date, h.owner_id, h.pri
  ),
  judged as (
    select i.owner_id, c.subject,
           (lm.status = 'submitted')::int as f_collected,
           (lm.status = 'submitted' or i.due < (pg_catalog.now() at time zone 'Asia/Seoul')::date)::int as f_judged
      from issued i
      join public.classes c on c.id = i.class_id and c.tenant_id = p_tenant
      left join lateral (
        select m.status from public.video_homework_marks m
         where m.tenant_id = p_tenant and m.class_id = i.class_id and m.student_id = i.student_id and m.homework_date = i.homework_date
         order by m.updated_at desc limit 1
      ) lm on true
     where (p_subjects is null or c.subject = any(p_subjects))
       and (p_owner is null or i.owner_id = p_owner)
  )
  select owner_id, subject, count(*)::int, sum(f_judged)::int, sum(f_collected)::int
    from judged group by owner_id, subject;
$fn$;

revoke all on function public.duty_video_homework_rollup(uuid, date, date, text[], uuid) from public, anon, authenticated;
grant execute on function public.duty_video_homework_rollup(uuid, date, date, text[], uuid) to service_role;

notify pgrst, 'reload schema';
commit;
