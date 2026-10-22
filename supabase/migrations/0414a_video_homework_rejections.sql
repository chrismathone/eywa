-- 영상 숙제 반려 표시 (원장 2026-10-13 *"선생님이 미확인으로 다시 변경해놓으면 업로드 가능하게"*).
--
-- 영상이 붙은 칸을 미확인으로 되돌리면 그 칸의 영상을 반려한다(집계 제외 + Drive 휴지통 — 앱 `reject-videos.ts`). 그런데 장부는 영상을
-- "가장 오래된, 아직 영상이 없는 숙제부터" 자동으로 붙이므로, 영상만 떼면 **다른 숙제에 붙어 있던 영상이 비운 칸으로 당겨져** 칸이 다시
-- 차고 뒤 숙제가 빈다(적대적 리뷰 2026-10-13). 그래서 숙제 칸마다 반려한 시각을 남긴다 — 그 시각 **전에** 올라온 영상은 그 칸에 자동으로
-- 붙지 않는다(반려 뒤에 새로 올린 영상 · 학생이 그 숙제를 골라 올린 영상 · 선생님이 손으로 배정한 영상은 붙는다).
--
-- 새 표 하나만 만든다(기존 표·함수는 그대로). 앱은 표가 없어도 돈다(반려만 "아직 사용할 수 없다"). 되돌리기는 이 파일에 적지 않는다.
begin;
set local lock_timeout = '5s';

create table if not exists public.video_homework_rejections (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  class_id uuid not null,
  student_id uuid not null,
  homework_date date not null,
  rejected_at timestamptz not null default now(),
  rejected_by uuid,
  primary key (tenant_id, class_id, student_id, homework_date),
  foreign key (tenant_id, class_id) references public.classes(tenant_id, id) on delete cascade,
  foreign key (tenant_id, student_id) references public.students(tenant_id, id) on delete cascade
);
create index if not exists video_homework_rejections_student on public.video_homework_rejections (tenant_id, student_id, homework_date);
alter table public.video_homework_rejections enable row level security;
revoke all on public.video_homework_rejections from public, anon, authenticated;
grant all on public.video_homework_rejections to service_role;
comment on table public.video_homework_rejections is
  '영상 숙제 반려 표시(반 × 학생 × 숙제일). 이 시각에 이미 있던 영상은 그 숙제 칸에 자동으로 다시 붙지 않는다. 서버 전용.';

-- 반려 한 번 = 한 거래: 반려 표시 남기기 · 영상 떼기(집계 제외 — 배정 이력 포함) · 그 숙제의 검사 기록 지우기.
-- 하나라도 안 되면 전부 되돌린다(반쯤 빈 칸 · 표시만 남은 칸을 만들지 않는다 — 적대적 리뷰 2026-10-13).
-- 자동 판정(reconcile_video_homework_outcomes)과 같은 학생 잠금을 잡고, 그 학생의 영상 줄도 잠근다(손 배정 · 연동 PC가 확인과 반영 사이에
-- 끼어들지 못하게 — 손 배정은 학생 잠금을 안 잡는다, 재리뷰 2026-10-13). 확인할 때 읽은 배정 번호를 그대로 넘겨 한 번 더 막는다.
-- `p_legacy_check` = 그 칸에 붙어 있던 숙제일 없는 옛 기록의 검사일(장부가 그 칸의 기록으로 본 것) — 함께 지운다.
-- `p_observed_at` = 앱이 반려할 영상을 고르려고 자료를 읽기 시작한 시각(자동 판정 `p_observed_at`과 같은 규약). 그 뒤에 이 학생의 영상이
-- 생기거나 바뀌었으면(배정 포함) 고른 목록이 낡았으니 'changed' — 안 그러면 그 틈에 생긴 영상은 반려 시각보다 먼저 생겨 이 칸에 다시
-- 안 붙고 반려 대상에도 없어 엉뚱한 칸을 채운다(재리뷰 2026-10-13).
-- 돌려주는 값: rejected · changed(그사이 영상 연결이 바뀌었다 — 아무것도 안 바꿨다) · invalid.
-- 이 파일의 이전판(인자 7·8개)이 적용된 DB가 있으면 잠금이 빠진 옛 함수가 따로 남으니 먼저 지운다(운영은 적용 전이라 없다).
drop function if exists public.reject_homework_videos(uuid,uuid,uuid,uuid,date,uuid[],text);
drop function if exists public.reject_homework_videos(uuid,uuid,uuid,uuid,date,uuid[],text,date);
create or replace function public.reject_homework_videos(
  p_tenant uuid, p_actor uuid, p_student uuid, p_class uuid, p_date date, p_videos uuid[], p_reason text, p_observed_at timestamptz,
  p_legacy_check date default null
) returns text language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_route jsonb; v_rev integer; v_revs integer[] := '{}'; v_result text;
begin
  if p_videos is null or cardinality(p_videos) not between 1 and 50 or p_reason is null or length(trim(p_reason)) not between 1 and 300
    or p_observed_at is null or array_position(p_videos, null) is not null
    or (select count(distinct x) from unnest(p_videos) x) <> cardinality(p_videos) then return 'invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||':'||p_student::text,0));
  -- 이 학생의 영상 줄을 전부 잠그고(손 배정 · 연동 PC가 끼어들지 못하게), 앱이 읽은 뒤에 바뀐 것이 있으면 아무것도 안 바꾼다.
  perform 1 from public.student_homework_videos where tenant_id=p_tenant and student_id=p_student for update;
  if exists(select 1 from public.student_homework_videos where tenant_id=p_tenant and student_id=p_student
      and greatest(created_at,uploaded_at,updated_at)>p_observed_at)
    or exists(select 1 from public.homework_video_assignments a join public.student_homework_videos v on v.id=a.video_id
      where a.tenant_id=p_tenant and v.student_id=p_student and a.updated_at>p_observed_at) then return 'changed'; end if;
  -- 먼저 전부 확인한다 — 하나라도 그사이 다른 반·숙제로 옮겨졌거나 이미 빠졌으면 아무것도 안 바꾼다.
  for i in 1..cardinality(p_videos) loop
    select route, assignment_revision into v_route, v_rev from public.homework_video_ledger_videos
      where tenant_id=p_tenant and id=p_videos[i] and student_id=p_student;
    if not found or v_route->>'classId' is distinct from p_class::text or coalesce(v_route->>'excluded','false')='true'
      or (v_route->>'homeworkDate' is not null and v_route->>'homeworkDate'<>p_date::text) then return 'changed'; end if;
    v_revs := v_revs || coalesce(v_rev,0);
  end loop;
  insert into public.video_homework_rejections(tenant_id,class_id,student_id,homework_date,rejected_at,rejected_by)
    values(p_tenant,p_class,p_student,p_date,now(),p_actor)
    on conflict(tenant_id,class_id,student_id,homework_date) do update set rejected_at=excluded.rejected_at,rejected_by=excluded.rejected_by;
  for i in 1..cardinality(p_videos) loop
    -- 권한은 앱이 칸 편집과 같은 관문으로 확인했고(자기가 낸 숙제거나 전체 권한), 영상이 이 반 · 이 숙제에 있는 것도 바로 위에서 봤다.
    v_result := public.set_homework_video_assignment(p_tenant,p_actor,true,p_student,p_class,p_videos[i],null,true,v_revs[i],p_reason);
    if v_result is distinct from 'saved' then raise exception '영상을 반려하지 못했습니다(%).', v_result; end if;
  end loop;
  delete from public.video_homework_marks where tenant_id=p_tenant and class_id=p_class and student_id=p_student
    and (homework_date=p_date or (p_legacy_check is not null and homework_date is null and check_date=p_legacy_check));
  return 'rejected';
end $$;
revoke all on function public.reject_homework_videos(uuid,uuid,uuid,uuid,date,uuid[],text,timestamptz,date) from public,anon,authenticated;
grant execute on function public.reject_homework_videos(uuid,uuid,uuid,uuid,date,uuid[],text,timestamptz,date) to service_role;

commit;
notify pgrst,'reload schema';
