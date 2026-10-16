-- 영상 숙제 취소(원장 2026-10-16 *"잘못 출제해서 없음으로 바꾸고 싶으면"* · *"미확인이나 미제출인 숙제에 한해서 숙제 취소할 수 있게"*).
--
-- 보고서를 이미 보낸 숙제는 원스크린에서 그 줄이 잠겨 '영상 과제'를 끌 수 없고, 영상 제출 현황의 '출제 취소'는 따로 낸 숙제만 거뒀다.
-- 이 함수가 그 숙제(반 × 학생 × 숙제일)를 **한 거래로** 거둔다:
--   ① 그날 보고서의 '영상 과제 있음' → '없음'(마감 · 링크 넣기도 비운다 — 원스크린에서 끈 것과 같다)
--   ② 따로 낸 숙제 · 옮겨 남긴 숙제 줄 삭제 ③ 그 숙제의 검사 기록(손으로 찍은 미수행 포함) 삭제 ④ 취소 기록(아래 표).
-- 자동 판정 줄(`video_homework_auto_outcomes`)은 남긴다 — 같은 숙제를 다시 내면 판정 회차가 이어져야 미제출 알림이 옛 알림과 겹쳐
-- 조용히 빠지지 않는다(운영실 집계는 지금 있는 숙제로 거르므로 남은 줄을 세지 않는다).
-- ClassNote로 이미 나간 글(이미지)은 그대로다(다시 보내지 않는다) — 공유 링크(/r)·인쇄본은 지금 값을 읽어 영상 숙제가 빠진다.
--
-- 돌려주는 값: cancelled(보고서는 안 건드림) · cancelled_report(그날 보고서의 '영상 과제 있음'을 '없음'으로) · kept(남이 쓴 보고서라
-- 따로 낸 표시만 지웠다 — 숙제는 그대로) · 거절 = invalid · changed(앱이 칸을 판정하려고 읽기 시작한 뒤(`p_observed_at`) 이 학생의
-- 영상 · 배정 · 기록이 바뀜) · submitted(완료 기록) · has_video(자동 판정 완료 · 그 숙제에 붙은 영상 — 반려한 영상은 빼고, 장부와 같은 조건:
-- 받은 영상 · 손 배정이거나 숙제일부터 14일 안) · uploading(그 숙제의 영상을 받는 중 — 처리 중인 영상 · 6시간 안에 시작한 올리기) · missing.
-- 앱(`cancel-homework.ts`)이 장부와 같은 판정(영상 자동 짝 포함)으로 먼저 거르고, 여기서 DB 사실로 한 번 더 본다.
-- `p_legacy_check` = 그 칸에 붙어 있던 숙제일 없는 옛 검사 기록의 검사일(반려 `reject_homework_videos`와 같은 규약) — 함께 지운다.
-- `p_touch_report` = 그날 보고서의 영상 과제를 꺼도 되나 — 앱이 정한다(수업보고서 전체 권한이거나 그 보고서를 처음 쓴 선생님). false인데
-- 그날 보고서에 영상 과제가 있으면 따로 낸 표시만 지운다('kept' — 영상 과제 값은 그 줄을 처음 쓴 선생님 것이다, 0336a 규칙).
-- 권한은 앱이 칸 편집과 같은 관문(`ledgerRoundWriteError`)으로 확인한다 — 서버 키 전용(다른 역할은 부를 수 없다).
--
-- 취소 기록 `video_homework_cancels`(반 × 학생 × 숙제일 → 마지막으로 취소한 시각) — 원스크린 세션 초안이 보고서 값보다 이겨서
-- (roster ⑤ 규약) 취소한 뒤에도 초안의 '있음'이 화면에 남고 발송 때 보고서에 다시 적혔다. 앱이 이 시각으로 가른다:
--   · 원스크린을 열 때 그날 취소된 숙제(보고서 '없음')는 초안보다 '없음'이 이긴다(`onescreen/page.tsx`)
--   · 그 화면이 취소를 모른 채(값을 맞춘 시각 < 취소 시각) '있음'을 보내면 '없음'을 지키고 그 줄은 보내지 않는다(`saveLessonReport`)
--   · 원스크린 '지난 수업 영상 숙제' 검사는 취소된 숙제에 기록을 만들지 않는다(`setVideoHomeworkMark`)
-- 🔴 정책 없는 RLS = 의도적이다 — 서버 키(앱 admin client)로만 읽고 쓴다. 강사·학부모 화면이 직접 읽을 표가 아니다([[#92]] · [[#104]]).
-- 앱보다 먼저 적용한다(새 표 · 새 함수만 — 기존 표·함수는 그대로). 늦으면 앱은 "아직 사용할 수 없는 기능"으로 알린다([[#95]]).
begin;
set local lock_timeout = '5s';

create table if not exists public.video_homework_cancels (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  homework_date date not null,
  cancelled_at timestamptz not null default now(),
  primary key (tenant_id, class_id, student_id, homework_date)
);
create index if not exists video_homework_cancels_day on public.video_homework_cancels (tenant_id, homework_date, student_id);
alter table public.video_homework_cancels enable row level security;
revoke all on public.video_homework_cancels from anon, authenticated;
grant select, insert, update, delete on public.video_homework_cancels to service_role;

-- 이 파일의 첫 판(인자 6개)을 적용한 DB가 있어도 오버로드가 둘로 남지 않게.
drop function if exists public.cancel_video_homework(uuid,uuid,uuid,date,timestamptz,date);
create or replace function public.cancel_video_homework(
  p_tenant uuid,p_class uuid,p_student uuid,p_date date,p_observed_at timestamptz,p_legacy_check date default null,p_touch_report boolean default true
) returns text language plpgsql security invoker set search_path=public,pg_temp as $$
declare reported boolean; changed integer;
begin
  if p_tenant is null or p_class is null or p_student is null or p_date is null or p_observed_at is null or p_touch_report is null then return 'invalid'; end if;
  -- 자동 판정 · 반려 · 따로 낸 숙제 취소와 같은 학생 잠금 — 그 사이에 끼어들지 못하게.
  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||':'||p_student::text,0));
  perform 1 from public.student_homework_videos where tenant_id=p_tenant and student_id=p_student for update;
  if exists(select 1 from public.student_homework_videos where tenant_id=p_tenant and student_id=p_student
      and greatest(created_at,uploaded_at,updated_at)>p_observed_at)
    or exists(select 1 from public.homework_video_assignments a join public.student_homework_videos v on v.id=a.video_id and v.tenant_id=p_tenant
      where a.tenant_id=p_tenant and v.student_id=p_student and a.updated_at>p_observed_at)
    or exists(select 1 from public.video_homework_marks where tenant_id=p_tenant and student_id=p_student and updated_at>p_observed_at)
  then return 'changed'; end if;
  reported := exists(select 1 from public.lesson_reports where tenant_id=p_tenant and class_id=p_class and student_id=p_student
    and report_date=p_date and video_homework=true);
  -- 앱은 남이 쓴 보고서의 '있음'을 보고 표시만 지우기로 정했는데 그사이 그 선생님이 껐다 — 앱이 건너뛴 칸 판정을 다시 해야 한다.
  if not p_touch_report and not reported then return 'changed'; end if;
  -- 남이 쓴 보고서의 숙제 — 그 선생님 숙제는 그대로 두고 따로 낸 표시만 지운다(검사 기록도 그 숙제의 것이라 남긴다).
  if reported and not p_touch_report then
    delete from public.video_homework_extra_issues where tenant_id=p_tenant and class_id=p_class and student_id=p_student and homework_date=p_date;
    get diagnostics changed=row_count;
    return case when changed>0 then 'kept' else 'missing' end;
  end if;
  if exists(select 1 from public.video_homework_marks where tenant_id=p_tenant and class_id=p_class and student_id=p_student
      and (homework_date=p_date or (p_legacy_check is not null and homework_date is null and check_date=p_legacy_check))
      and status='submitted') then return 'submitted'; end if;
  if exists(select 1 from public.video_homework_auto_outcomes where tenant_id=p_tenant and class_id=p_class and student_id=p_student
      and homework_date=p_date and status='submitted')
    or exists(select 1 from public.homework_video_ledger_videos where tenant_id=p_tenant and student_id=p_student
      and status='uploaded' and drive_file_id is not null
      and route->>'classId'=p_class::text and route->>'homeworkDate'=p_date::text and coalesce(route->>'excluded','false')<>'true'
      and (coalesce(route->>'manualAssignment','false')='true' or (posted_at at time zone 'Asia/Seoul')::date between p_date and p_date+14))
  then return 'has_video'; end if;
  if exists(select 1 from public.homework_video_ledger_videos where tenant_id=p_tenant and student_id=p_student and status in ('queued','processing')
      and route->>'classId'=p_class::text and route->>'homeworkDate'=p_date::text and coalesce(route->>'excluded','false')<>'true')
    or exists(select 1 from public.homework_video_link_uploads u join public.homework_video_links l on l.id=u.link_id and l.tenant_id=p_tenant
      where u.tenant_id=p_tenant and l.student_id=p_student and l.class_id=p_class and u.status='started'
      and u.route->>'homeworkDate'=p_date::text and u.created_at>now()-interval '6 hours')
  then return 'uploading'; end if;
  if not reported
    and not exists(select 1 from public.video_homework_extra_issues where tenant_id=p_tenant and class_id=p_class and student_id=p_student
      and homework_date=p_date)
    and not exists(select 1 from public.video_homework_marks where tenant_id=p_tenant and class_id=p_class and student_id=p_student
      and (homework_date=p_date or (p_legacy_check is not null and homework_date is null and check_date=p_legacy_check)))
  then return 'missing'; end if;
  update public.lesson_reports set video_homework=false, video_homework_due=null, video_submit_link=false
    where tenant_id=p_tenant and class_id=p_class and student_id=p_student and report_date=p_date and video_homework=true;
  delete from public.video_homework_extra_issues where tenant_id=p_tenant and class_id=p_class and student_id=p_student and homework_date=p_date;
  delete from public.video_homework_marks where tenant_id=p_tenant and class_id=p_class and student_id=p_student
    and (homework_date=p_date or (p_legacy_check is not null and homework_date is null and check_date=p_legacy_check));
  -- 취소 시각 = 실제로 반영한 순간(clock_timestamp) — now()는 거래 시작이라 잠금을 기다린 만큼 앞당겨 찍혀, 그 사이 연 화면이
  -- 취소를 아는 것처럼 판정된다(재리뷰 2026-10-16).
  insert into public.video_homework_cancels(tenant_id,class_id,student_id,homework_date,cancelled_at)
    values(p_tenant,p_class,p_student,p_date,clock_timestamp())
    on conflict(tenant_id,class_id,student_id,homework_date) do update set cancelled_at=excluded.cancelled_at;
  return case when reported then 'cancelled_report' else 'cancelled' end;
end $$;
revoke all on function public.cancel_video_homework(uuid,uuid,uuid,date,timestamptz,date,boolean) from public,anon,authenticated;
grant execute on function public.cancel_video_homework(uuid,uuid,uuid,date,timestamptz,date,boolean) to service_role;

commit;
notify pgrst,'reload schema';
