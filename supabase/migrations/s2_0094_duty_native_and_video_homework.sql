-- s2_0094 — 업무 완성도: 원어민 선생님 표시 · 영상 숙제 참고 열 (2026-11-12)
--
-- 왜:
--   · 원장 *"김태건 선생님도 원어민 선생님(한국계 미국인?)이므로 리스트에서 제외"* · *"근무 설정에 '담당 과목'이 '영어'일 경우 '원어민 선생님' 토글을 두고
--     세팅시 노출되지 않게할것"* — 이름에 한글이 없으면 원어민으로 보던 판정(이름만)으로는 한글 이름의 원어민을 못 가린다.
--   · 원장 *"항목에 영상숙제 열도추가"* · *"영상숙제 출제와 회수를 기준으로 할것"* · *"회수라는건 학생이 출제한 영상개수"* ·
--     *"영상 숙제를 출제하지 않은 선생님이 유리할 수도 있으니, 이 부분을 불이익 당하지않게"* → 등급 · 전체에 넣지 않는 **참고 열**(평균평점 · 퇴원보고서와 같다).
-- 무엇:
--   · users.native_teacher — 근무 설정 '원어민 선생님' 토글(담당 과목에 영어가 있을 때만 보인다). 본인 행 수정 허용 목록에 없으니 본인은 못 바꾼다(가드 트리거 그대로).
--   · public.duty_video_homework_rollup — 영상 숙제를 낸 선생님 × 과목: 출제(학생 × 숙제) · 판정 대상(회수됐거나 마감이 지난 것) · 회수(영상이 들어와 완료).
--       출제 = 영상 과제가 나간 보고서(`lesson_reports.video_homework`) + 보고서 없이 따로 낸 숙제(옮겨 남긴 숙제 `kept`는 뺀다) · 같은 반 × 학생 × 날짜는 한 번.
--       낸 사람 = 보고서 작성 계정(`created_by` — 영상 제출 현황의 '내가 낸 숙제'와 같다) · 따로 낸 숙제는 그 숙제의 선생님 · 모르면 반 담임.
--       회수 = 그 숙제 칸의 마지막 검사 기록이 완료(`video_homework_marks.status = 'submitted'` — 자동 판정 · 손 완료 모두).
--       마감 = 보고서에 고른 마감(`video_homework_due`) · 없으면 숙제일 + 7일(영상 숙제 `due.ts`와 같다). 마감 전이고 아직 안 들어온 숙제는 판정 대상이 아니다.
--       기간 = 숙제일(KST 날짜). 테스트 원생 제외.
-- 실행권: 앱 service_role만(관리 화면 집계와 같다).

begin;

alter table public.users add column if not exists native_teacher boolean not null default false;
comment on column public.users.native_teacher is
  '원어민 선생님(근무 설정 토글 · 담당 과목에 영어가 있을 때만 보인다). 켜면 업무 완성도 관리에서 뺀다. 이름에 한글이 없는 계정은 이 값과 무관하게 원어민으로 본다.';

create or replace function public.duty_video_homework_rollup(p_tenant uuid, p_from date, p_to date, p_subjects text[], p_owner uuid)
returns table (owner_id uuid, subject text, issued int, judged int, collected int)
language sql stable security definer set search_path = public
as $fn$
  with issued as (
    select distinct on (h.class_id, h.student_id, h.homework_date) h.class_id, h.student_id, h.homework_date, h.owner_id, h.due
      from (
        select r.class_id, r.student_id, r.report_date as homework_date, coalesce(r.created_by, c.teacher_id) as owner_id,
               coalesce(r.video_homework_due, r.report_date + 7) as due, 0 as pri
          from public.lesson_reports r
          join public.classes c on c.id = r.class_id and c.tenant_id = r.tenant_id
         where r.tenant_id = p_tenant and r.video_homework = true and r.class_id is not null
           and r.report_date between p_from and p_to
        union all
        select e.class_id, e.student_id, e.homework_date, coalesce(e.teacher_id, e.issued_by, c.teacher_id), e.homework_date + 7, 1
          from public.video_homework_extra_issues e
          join public.classes c on c.id = e.class_id and c.tenant_id = e.tenant_id
         where e.tenant_id = p_tenant and not e.kept and e.homework_date between p_from and p_to
      ) h
      join public.students st on st.id = h.student_id and st.tenant_id = p_tenant and not st.is_test
     order by h.class_id, h.student_id, h.homework_date, h.pri
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
     where i.owner_id is not null
       and (p_subjects is null or c.subject = any(p_subjects))
       and (p_owner is null or i.owner_id = p_owner)
  )
  select owner_id, subject, count(*)::int, sum(f_judged)::int, sum(f_collected)::int
    from judged group by owner_id, subject;
$fn$;

revoke all on function public.duty_video_homework_rollup(uuid, date, date, text[], uuid) from public, anon, authenticated;
grant execute on function public.duty_video_homework_rollup(uuid, date, date, text[], uuid) to service_role;

notify pgrst, 'reload schema';
commit;
