-- 0453a — 퇴원보고서 '관리자 바로 처리'(강사 작성 없이 바로 퇴원·수강종료).
--
-- 원장 2026-10-23 *"퇴원한 학생의 퇴원보고서를 새로 써야하는 경우는 앞으로 없도록. 퇴원 보고서를 써야 퇴원처리가 가능하도록."*
-- + *"대신 관리자가 어느 학생에 대해 퇴원보고서 카드에서 '강사 작성 없이 바로 퇴원(수강종료)' 가능하게"*.
-- 직원 화면의 직접 퇴원은 앱에서 막는다(`src/features/withdrawals/via-report.ts`). 대신 관리자가 보고서 기록 한 건을 남기며 바로 처리한다.
--
-- ① `withdrawal_reports.direct` — 바로 처리 보고서 표식. 이 행만 **작성자 = 승인 관리자 = 요청자**(원장 없음)를 허용하도록 CHECK를 넓힌다
--    (일반 요청의 '작성자·관리자·원장은 서로 다르다'는 그대로). 지금 다니는 반이 없는 학생(퇴원만)은 과목이 비어 있을 수 있다.
--    앱은 칸을 읽지 않고 '작성자 = 관리자 = 요청자' 모양으로 바로 처리를 알아본다(옛 스키마에서도 안 죽게 · #95) — 그 모양은 이 CHECK가 direct와 묶는다.
-- ② `transition_withdrawal_report`(승인 완료 · 처리일 cron이 쓰는 **유일한 처리 함수**)를 글자만 두 곳 고친다(0367a·0369a와 같은 방식 —
--    본문을 통째로 옮겨 쓰지 않는다 · 바꿀 글자가 없으면 중단):
--    · apply = 처리일 cron(행위자 없음)만 → 바로 처리 보고서는 **처리한 관리자 본인**도 그 자리에서 apply한다(이력에 사람이 남고, 자기에게 알림이 안 간다)
--    · 종료할 수강이 0개면 거절 → 바로 처리의 **퇴원**은 0개도 된다(다니는 반 없는 학생)
-- ③ `direct_withdrawal_report(tenant, actor, payload)` — 보고서 묶음·보고서(처리 예약 상태)·이력을 남기고, 처리일이 오늘 이전이면 ②의 apply를
--    같은 트랜잭션에서 부른다(미래면 그날 00:05 cron이 같은 apply). 강사 작성 요청 알림·할 일은 만들지 않는다(처리 예약 상태라 할 일 트리거가 열지 않는다).
--    검사는 작성 요청 함수(`request_withdrawal_report_group`)와 같은 축 + 승인을 건너뛰므로 학원 설정 '원생 상태 변경' 담당 명단:
--    관리자 역할 · 상태 변경 담당(명단이 있으면) · 재원·휴원 · 퇴원 예약 없음 · 진행 중 보고서 없음 ·
--    지금 수강 중인 반만 · 종강/운영 안 하는 반 제외 · 개인 과목 범위 · 종료일 범위. 사유 목록은 전이 함수와 같다(가드 `via-report-wiring.test.ts`).
--
-- 🔴 **앱 배포 전에 적용한다** — 앱은 이 칸이 없어도 죽지 않지만(#95 · 바로 처리 선택지는 숨는다), 관리 도구 '수강 없는 재원생' 정리가 이 함수를
--    부르므로 미적용 DB에선 정리가 '준비 중'으로 멈추고, 다니는 반이 없는 학생을 퇴원시킬 길이 없다. 지금 앱과 함께 돌아도 문제가 없다.
-- 되돌리기 = `scripts/_oneoff/revert-0453a-withdrawal-report-direct.sql`(바로 처리 기록이 있으면 멈춘다).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.withdrawal_reports add column if not exists direct boolean not null default false;
comment on column public.withdrawal_reports.direct is '관리자 바로 처리(강사 작성 없이) — 작성자 = 승인 관리자 = 요청자 · 0453a';

alter table public.withdrawal_reports drop constraint if exists withdrawal_reports_check;
alter table public.withdrawal_reports add constraint withdrawal_reports_check check (
  case when direct then teacher_id = manager_id and manager_id = requested_by and director_id is null
  else teacher_id <> manager_id and teacher_id <> director_id and manager_id <> director_id end);
alter table public.withdrawal_reports drop constraint if exists withdrawal_reports_subjects_check;
alter table public.withdrawal_reports add constraint withdrawal_reports_subjects_check check (cardinality(subjects) > 0 or direct);

do $$
declare
  fn constant text := 'public.transition_withdrawal_report(uuid,uuid,uuid,text,jsonb)';
  definition text;
  old_apply constant text := 'if p_actor is not null or g.status<>''scheduled'' or g.effective_date>today then raise exception ''처리일이 된 승인 보고서만 처리할 수 있습니다.''; end if;';
  new_apply constant text := 'if (p_actor is not null and not (r.direct and p_actor=g.requested_by)) or g.status<>''scheduled'' or g.effective_date>today then raise exception ''처리일이 된 승인 보고서만 처리할 수 있습니다.''; end if;';
  old_empty constant text := 'if coalesce(cardinality(targets),0)=0 then raise exception ''종료할 수강을 찾을 수 없습니다.''; end if;';
  new_empty constant text := 'if coalesce(cardinality(targets),0)=0 and not (r.direct and g.exit_kind=''withdrawal'') then raise exception ''종료할 수강을 찾을 수 없습니다.''; end if;';
begin
  select pg_get_functiondef(fn::regprocedure) into definition;
  if position(new_apply in definition) = 0 then
    if position(old_apply in definition) = 0 then raise exception '0453a: 처리(apply) 조건 글자를 찾지 못했습니다'; end if;
    definition := replace(definition, old_apply, new_apply);
  end if;
  if position(new_empty in definition) = 0 then
    if position(old_empty in definition) = 0 then raise exception '0453a: 빈 종료 대상 조건 글자를 찾지 못했습니다'; end if;
    definition := replace(definition, old_empty, new_empty);
  end if;
  execute definition;
end $$;

create or replace function public.direct_withdrawal_report(p_tenant uuid, p_actor uuid, p_payload jsonb)
returns uuid language plpgsql set search_path = public as $function$
declare
  s public.students; actor public.users; snap jsonb; chosen text[]; targets uuid[]; d date; kind text; scope_row jsonb;
  gid uuid; rid uuid; body jsonb; reason text; detail text; memo text; special jsonb;
  today date := (now() at time zone 'Asia/Seoul')::date;
begin
  select * into actor from public.users where id = p_actor and tenant_id = p_tenant and status = 'active';
  if actor.id is null or actor.system_role::text not in ('master','admin','manager') then raise exception '관리자가 바로 처리할 수 있습니다.'; end if;
  -- 승인 없이 바로 퇴원시키는 길이라 예전 직접 퇴원과 같은 자격을 더 본다 — 학원 설정 '원생 상태 변경' 담당 명단(앱 `studentStatusManagerIds`와
  -- 같은 규칙: 칸이 없으면 예전 방식 그대로 · 칸이 있으면 명단에 든 사람만 · 모양이 틀리면 아무도). 원장 역할·운영자는 명단과 무관.
  if actor.system_role::text <> 'master' and not coalesce(public.is_super_admin(actor.id), false) then
    select ts.data#>'{permissions,specialAccess}' into special from public.tenant_settings ts where ts.tenant_id = p_tenant;
    if special is not null and (jsonb_typeof(special) <> 'object'
      or (special ? 'studentStatusManagerIds' and (jsonb_typeof(special->'studentStatusManagerIds') <> 'array' or not ((special->'studentStatusManagerIds') ? actor.id::text)))) then
      raise exception '원생 상태 변경을 맡은 사람만 바로 처리할 수 있습니다.';
    end if;
  end if;
  select * into s from public.students where tenant_id = p_tenant and id = (p_payload->>'studentId')::uuid for update;
  if s.id is null or s.status::text not in ('enrolled','on_hold') or s.withdrawn_at is not null then raise exception '재원·휴원 학생만 처리할 수 있습니다. 기존 퇴원 예약을 확인해 주세요.'; end if;
  perform 1 from public.enrollments where tenant_id = p_tenant and student_id = s.id for update;
  perform 1 from public.classes c join public.enrollments e on e.class_id = c.id where e.student_id = s.id and e.tenant_id = p_tenant for share of c;
  if exists(select 1 from public.withdrawal_reports where tenant_id = p_tenant and student_id = s.id and status not in ('completed','canceled'))
    or exists(select 1 from public.withdrawal_report_groups where tenant_id = p_tenant and student_id = s.id and status not in ('completed','canceled')) then
    raise exception '이 학생의 진행 중인 보고서가 있습니다.';
  end if;
  snap := public.withdrawal_report_snapshot(p_tenant, s.id);

  if jsonb_typeof(p_payload->'enrollmentIds') is distinct from 'array' then raise exception '종료할 반을 선택해 주세요.'; end if;
  select coalesce(array_agg(distinct v::uuid order by v::uuid), '{}') into targets from jsonb_array_elements_text(p_payload->'enrollmentIds') x(v);
  if cardinality(targets) > 100 or exists(select 1 from unnest(targets) x where not exists(select 1 from jsonb_array_elements(snap->'courses') e where (e->>'id')::uuid = x)) then
    raise exception '현재 학생이 수강 중인 반을 선택해 주세요.';
  end if;
  if exists(select 1 from public.enrollments e join public.classes c on c.id = e.class_id where e.tenant_id = p_tenant and e.student_id = s.id and e.id = any(targets) and (not c.is_active or c.closed_at is not null)) then
    raise exception '종강되었거나 운영하지 않는 반은 선택할 수 없습니다. 반 목록을 새로고침해 주세요.';
  end if;
  -- 반을 하나도 안 고르는 것은 **지금 운영 중인 반에 다니는 수강이 없는 학생**(퇴원만)일 때뿐이다.
  if cardinality(targets) = 0 and exists(select 1 from jsonb_array_elements(snap->'courses') e join public.classes c on c.id = (e->>'classId')::uuid and c.tenant_id = p_tenant where c.is_active and c.closed_at is null) then
    raise exception '종료할 반을 선택해 주세요.';
  end if;
  select coalesce(array_agg(distinct e->>'subject' order by e->>'subject'), '{}') into chosen from jsonb_array_elements(snap->'courses') e where (e->>'id')::uuid = any(targets);

  -- 개인 과목 범위(작성 요청과 같은 규칙) — 원장 역할·운영자는 범위 밖. 다니는 반이 없는 학생은 과목으로 가를 수 없어 범위가 걸린 사람은 못 한다.
  if actor.system_role::text <> 'master' and not coalesce(public.is_super_admin(actor.id), false) then
    select x into scope_row from public.tenant_settings ts, lateral jsonb_array_elements(coalesce(ts.data#>'{permissions,specialAccess,staffSubjectScopes}','[]')) x
      where ts.tenant_id = p_tenant and x->>'userId' = actor.id::text limit 1;
    if scope_row is not null and (cardinality(chosen) = 0 or exists(select 1 from unnest(chosen) x where not coalesce(scope_row->'subjects','[]') ? x)) then
      raise exception '담당 과목의 원생만 처리할 수 있습니다.';
    end if;
  end if;

  reason := coalesce(p_payload->>'reason', '');
  if reason not in ('graduated','relocation','illness','competitor','financial','schedule','dissatisfaction','grades','motivation','method','career','peers','advised','other') then
    raise exception '퇴원 사유를 골라 주세요.';
  end if;
  detail := btrim(coalesce(p_payload->>'reasonDetail', ''));
  memo := btrim(coalesce(p_payload->>'memo', ''));
  if char_length(detail) > 80 or char_length(memo) > 5000 then raise exception '사유 항목을 확인해 주세요.'; end if;
  if reason = 'other' and memo = '' then raise exception '''기타''는 메모에 실제 사유를 적어 주세요.'; end if;

  d := (p_payload->>'effectiveDate')::date;
  if d is null or d < coalesce(s.enrolled_at, d) or d > today + 365 then raise exception '종료일은 등록일 이후, 오늘부터 1년 이내로 지정해 주세요.'; end if;
  -- 처리 구분은 작성 요청과 같은 식 — 운영 중인 반의 수강이 남으면 과목 수강종료, 아니면 전체 퇴원.
  kind := case when exists(select 1 from jsonb_array_elements(snap->'courses') e where not (e->>'id')::uuid = any(targets)
    and exists(select 1 from public.classes c where c.id = (e->>'classId')::uuid and c.tenant_id = p_tenant and c.is_active and c.closed_at is null)) then 'subject_end' else 'withdrawal' end;

  -- 본문 = 보고서 양식의 칸 그대로(상담·담임 의견은 비운다) — 처리 함수가 사유·세부·메모(detail)를 학생과 닫는 수강에 옮겨 적는다.
  body := jsonb_build_object('reason', reason, 'reasonDetail', detail, 'detail', memo, 'studentConsultation', '', 'parentConsultation', '',
    'teacherOpinion', '', 'attendance', '', 'tuition', '', 'arrears', 'unknown', 'arrearsNote', '');
  insert into public.withdrawal_report_groups(tenant_id, student_id, requested_by, teacher_ids, manager_ids, director_ids, subjects, effective_date, exit_kind, snapshot, enrollment_ids, status)
    values (p_tenant, s.id, p_actor, array[p_actor], array[p_actor], '{}', chosen, d, kind, snap, targets, 'scheduled') returning id into gid;
  insert into public.withdrawal_reports(tenant_id, student_id, requested_by, teacher_id, manager_id, director_id, manager_ids, director_ids, group_id, group_leader,
      subjects, effective_date, exit_kind, request_note, snapshot, enrollment_ids, body, status, manager_decisions, manager_approved_at, direct)
    values (p_tenant, s.id, p_actor, p_actor, p_actor, null, array[p_actor], '{}', gid, true,
      chosen, d, kind, '', snap, targets, body, 'scheduled', jsonb_build_object(p_actor::text, now()), now(), true) returning id into rid;
  insert into public.withdrawal_report_events(tenant_id, report_id, actor_id, action, from_status, to_status, body)
    values (p_tenant, rid, p_actor, 'direct', null, 'scheduled', body);
  -- 처리일이 됐으면 지금 — 승인된 보고서와 **같은 처리 함수**(학생·수강·담당 정보가 그대로인지 다시 대조한 뒤 퇴원·수강종료).
  if d <= today then perform public.transition_withdrawal_report(p_tenant, p_actor, rid, 'apply', '{}'::jsonb); end if;
  return rid;
end
$function$;

revoke all on function public.direct_withdrawal_report(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.direct_withdrawal_report(uuid, uuid, jsonb) to service_role;
revoke all on function public.transition_withdrawal_report(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.transition_withdrawal_report(uuid, uuid, uuid, text, jsonb) to service_role;

notify pgrst, 'reload schema';

commit;
