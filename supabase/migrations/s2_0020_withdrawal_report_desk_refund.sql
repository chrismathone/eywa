-- s2_0020 — 퇴원보고서: 원장 승인 단계 없앰 · 작성 강사가 과목 관리자면 관리자 승인 생략 · 데스크 환불 단계 · 반 이름만 바뀐 건 '정보 변경' 아님 (2026-11-03)
--
-- 왜: 원장 2026-11-03 —
--   ① 요청 창의 '원장 승인'을 없앤다. 퇴원 승인 = 관리자 승인 + (환불을 요청했으면) 데스크 환불 처리. 둘 다 끝나면 지금처럼 처리(미래 날짜면 예약).
--   ② 작성 강사가 그 과목 관리자면 관리자 승인을 생략한다(제출 = 관리자 승인). 그동안은 요청 창이 원장을 관리자 칸에 넣어 원장이 승인했다(김다예).
--   ③ *"환불요청시 퇴원보고서에 '데스크 환불 요청 승인 단계'도 같이 추가하고 상태에도 마찬가지로 알아볼 수 있게."*
--   ④ 반 이름만 바뀐(LE1→LE2) 보고서가 '요청 이후 학생·수강·담당 강사가 변경되었습니다'로 승인이 막혔다(김소은·김태린 — 그날 손으로 맞춤).
-- 무엇:
--   1) 대조 열쇠 `withdrawal_report_compare_key(스냅숏, 과목|null)` — 수강의 반 이름(className)과 고정 이력(subjectHistory)을 빼고 수강 id 순으로.
--      제출 트리거 · 처리 함수 · 옛 단건 처리 함수(_v1)의 스냅숏 대조가 모두 이 열쇠를 쓴다(앱 `snapshotMatches`도 같은 규칙).
--   2) 데스크 환불 연결 표 `withdrawal_report_refunds`(보고서 · 묶음 · 환불 요청서 · 데스크 담당 · 연결한 사람)와 연결 함수 `attach_withdrawal_report_refund`
--      (보고서 이력에 '데스크 환불 요청'을 남긴다) · 판정 `withdrawal_report_refund_pending(묶음)` = 연결된 환불 요청서 중 환불완료일자가 빈 것이 있다.
--      요청서에는 외래키를 걸지 않는다 — 수납·자료실의 요청서 삭제를 막지 않고, 지운 요청서는 판정에서 빠진다(더는 기다릴 환불이 아니다).
--   3) 작성 요청(`request_withdrawal_report_group`): 원장(directorIds)은 받지 않는다(늘 빈 값). 승인 관리자 0명은 작성 강사가 모두 관리자급
--      (관리자·매니저·원장 · 운영자 계정 제외)일 때만 — 과목 관리자인지는 앱(요청 창 · 서버 액션)이 가린다. 묶음의 '관리자 1명 이상' CHECK와
--      보고서 manager_id NOT NULL을 푼다(관리자 0명 묶음의 보고서는 manager_id = null · manager_ids = '{}').
--   4) 처리 함수(`transition_withdrawal_report`):
--      - 제출: 묶음 관리자가 0명이면 바로 'approved'(관리자 승인 시각 = 제출 시각) — 제출 트리거가 이 전이도 대조한다.
--      - 모든 보고서 승인 + 데스크 환불 대기 → 묶음은 'pending' 그대로, 알림 '퇴원보고서 승인 완료 · 데스크 환불 대기'(담임·요청자).
--      - 'apply'(처리일 cron): 데스크 환불 대기면 오류 없이 그대로 돌려준다(앱 cron이 '미룸'으로 센다 · 환불 완료 때 release).
--      - 'release'(새 동작 — 환불 완료를 저장한 사람 또는 시스템 null): 승인이 끝난 묶음(또는 처리일이 된 예약)의 환불이 끝났으면 지금 처리 —
--        미래 날짜면 예약 · 정보가 바뀌었으면 재검토(apply와 같은 대조·같은 처리 본문).
--      - 관리자 0명 묶음은 최종 처리 때 작성 강사가 아직 관리자급인지도 본다(승인자 재검사와 같은 줄).
--      - 원장 단계(director_pending)는 옛 보고서를 위해 남긴다(2026-11-03 진행 중 0건) — 새로 들어가는 길은 없다.
--   5) `release_withdrawal_report_refunds(지점|null, 요청서|null, 행위자|null)` — 환불이 끝난 묶음을 찾아 release(묶음마다 따로 · 실패는 결과 줄의 error).
--      수납의 환불완료 저장·요청서 삭제가 그 요청서로 부르고, 처리일 cron이 전체(null)로 한 번 더 쓴다(안전망).
-- 순서: 🔴 앱보다 먼저(#95). 지금 배포된 앱과 함께 돌아도 된다 — 지금 앱은 관리자 1명 이상만 보내고(그대로 통과), 원장을 고르면 무시된다
--      (원장 결정과 같다 — 관리자 승인으로 끝난다). 연결 표·release는 새 앱만 쓴다. 각 함수는 운영 정의(2026-11-03 덤프)의 지문(공백을 뺀 md5)이
--      맞을 때만 바꾼다(다른 세션이 먼저 고쳤으면 멈춘다 — 그 고침을 이 파일에 옮긴 뒤 지문을 갱신).
-- 데이터: 진행 중 '김다예'(작성 강사 정유진 = 영어 관리자 · 승인자 칸에 원장 설현)는 앱 배포 뒤 별도 스크립트로 관리자 0명으로 바꾼다(작성 요청 상태일 때만).
-- 되돌리기 = scripts/_oneoff/revert-s2_0020-withdrawal-report-desk-refund.sql(앱을 먼저 되돌린 뒤 · 관리자 0명 묶음이나 데스크 환불 대기 묶음이 진행 중이면 멈춘다).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
declare
  want constant jsonb := jsonb_build_object(
    'public.transition_withdrawal_report(uuid,uuid,uuid,text,jsonb)', '93c6726c93a9da74126af8ca4e46f697',
    'public.request_withdrawal_report_group(uuid,uuid,jsonb)', '134c805327860d8c7c15ea1760999d2f',
    'public.check_withdrawal_report_submission()', 'fea1dc023f90b4ad8bc120fe2db5d0bd',
    'public.transition_withdrawal_report_v1(uuid,uuid,uuid,text,jsonb)', '22743b05b5145f3de6734ba3e17aba0f');
  fn text;
  got text;
begin
  for fn in select jsonb_object_keys(want) loop
    select md5(regexp_replace(pg_get_functiondef(fn::regprocedure), '[[:space:]]+', '', 'g')) into got;
    if got is distinct from want->>fn then
      raise exception 's2_0020: % 의 운영 정의가 기준(2026-11-03)과 다릅니다(%). 바뀐 내용을 이 파일에 옮긴 뒤 지문을 갱신하세요.', fn, got;
    end if;
  end loop;
end $$;

-- ── 1) 대조 열쇠 — 반 이름·고정 이력을 빼고 수강 id 순으로(과목을 주면 그 과목 수강만) ──────────────────────────────
create or replace function public.withdrawal_report_compare_key(p_snapshot jsonb, p_subjects text[]) returns jsonb
language sql immutable security invoker set search_path = public as $$
 select case when p_snapshot is null then null else
  (p_snapshot - array['courses','subjectHistory']) || jsonb_build_object('courses', coalesce((
    select jsonb_agg(e - 'className' order by e->>'id') from jsonb_array_elements(coalesce(p_snapshot->'courses', '[]'::jsonb)) e
    where p_subjects is null or e->>'subject' = any(p_subjects)), '[]'::jsonb)) end
$$;
revoke all on function public.withdrawal_report_compare_key(jsonb, text[]) from public, anon, authenticated;
grant execute on function public.withdrawal_report_compare_key(jsonb, text[]) to service_role;

-- ── 2) 데스크 환불 연결 ──────────────────────────────────────────────────────────────────────────────
create table if not exists public.withdrawal_report_refunds (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  report_id uuid not null references public.withdrawal_reports(id) on delete cascade,
  group_id uuid references public.withdrawal_report_groups(id) on delete cascade,
  -- 환불 요청서(academy_documents · refund_request) — 외래키 없음(머리말 2).
  document_id uuid not null unique,
  desk_id uuid references public.users(id) on delete set null,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);
comment on table public.withdrawal_report_refunds is '퇴원보고서 데스크 환불 단계 — 보고서에서 만든 환불 요청서. 요청서의 환불완료일자가 비어 있으면 묶음 처리를 기다린다(s2_0020).';
create index if not exists withdrawal_report_refunds_group on public.withdrawal_report_refunds(tenant_id, group_id);
create index if not exists withdrawal_report_refunds_report on public.withdrawal_report_refunds(tenant_id, report_id);
alter table public.withdrawal_report_refunds enable row level security;
revoke all on public.withdrawal_report_refunds from public, anon, authenticated;
grant select, insert on public.withdrawal_report_refunds to service_role;

create or replace function public.withdrawal_report_refund_pending(p_group uuid) returns boolean
language sql stable security invoker set search_path = public as $$
 select exists(select 1 from public.withdrawal_report_refunds f
   join public.academy_documents d on d.id = f.document_id and d.tenant_id = f.tenant_id and d.form_type = 'refund_request'
   where f.group_id = p_group and coalesce(btrim(d.form_data #>> '{result,completedDate}'), '') = '')
$$;
revoke all on function public.withdrawal_report_refund_pending(uuid) from public, anon, authenticated;
grant execute on function public.withdrawal_report_refund_pending(uuid) to service_role;

create or replace function public.attach_withdrawal_report_refund(p_tenant uuid, p_actor uuid, p_report uuid, p_document uuid, p_desk uuid)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  gid uuid; g public.withdrawal_report_groups; r public.withdrawal_reports; doc_description text; desk_name text; gates boolean := false; link uuid;
begin
  if not exists(select 1 from public.users where tenant_id = p_tenant and id = p_actor and status = 'active') then raise exception '작업 권한을 확인할 수 없습니다.'; end if;
  -- 처리 함수와 같은 잠금 순서(묶음 → 보고서).
  select group_id into gid from public.withdrawal_reports where tenant_id = p_tenant and id = p_report;
  if gid is not null then select * into g from public.withdrawal_report_groups where tenant_id = p_tenant and id = gid for update; end if;
  select * into r from public.withdrawal_reports where tenant_id = p_tenant and id = p_report for update;
  if r.id is null or r.status = 'canceled' then raise exception '환불을 연결할 수 있는 퇴원보고서가 아닙니다.'; end if;
  select description into doc_description from public.academy_documents where tenant_id = p_tenant and id = p_document and form_type = 'refund_request';
  if doc_description is null or position(('report:' || p_report::text || ' ') in doc_description) = 0 then raise exception '이 보고서에서 만든 환불 요청서가 아닙니다.'; end if;
  if p_desk is not null then
    select display_name into desk_name from public.users where tenant_id = p_tenant and id = p_desk and status = 'active';
    if desk_name is null then raise exception '데스크 담당자를 다시 골라 주세요.'; end if;
  end if;
  insert into public.withdrawal_report_refunds(tenant_id, report_id, group_id, document_id, desk_id, created_by)
    values (p_tenant, r.id, gid, p_document, p_desk, p_actor) on conflict (document_id) do nothing returning id into link;
  if link is null then return jsonb_build_object('attached', false, 'groupId', gid, 'groupStatus', g.status, 'gates', false); end if;
  -- 묶음이 아직 처리 전(진행 중 · 처리 예약)이면 이 환불이 끝나야 처리한다. 끝난 보고서에 붙인 환불은 기다리게 하지 않는다.
  gates := gid is not null and g.status in ('pending', 'scheduled');
  insert into public.withdrawal_report_events(tenant_id, report_id, actor_id, action, from_status, to_status, comment)
    values (p_tenant, r.id, p_actor, 'refund', r.status, r.status,
      '데스크 환불 요청' || coalesce(' · ' || desk_name, '') || case when gates then ' — 환불 처리(환불완료일자) 뒤 퇴원·수강종료' else '' end);
  return jsonb_build_object('attached', true, 'groupId', gid, 'groupStatus', g.status, 'gates', gates);
end $$;
revoke all on function public.attach_withdrawal_report_refund(uuid, uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.attach_withdrawal_report_refund(uuid, uuid, uuid, uuid, uuid) to service_role;

-- ── 3) 관리자 0명 묶음을 받는다 ───────────────────────────────────────────────────────────────────────
alter table public.withdrawal_report_groups drop constraint if exists withdrawal_report_groups_manager_ids_check;
alter table public.withdrawal_reports alter column manager_id drop not null;

create or replace function public.check_withdrawal_report_submission()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
declare
 cmp_subjects text[];
begin
 -- 제출(관리자 0명 묶음은 제출이 곧 승인 — requested/revision → approved)과 승인 결정마다 대조한다.
 if (new.status in ('manager_pending','approved') and old.status in ('requested','revision')) or
  (new.group_id is not null and new.status in ('manager_pending','director_pending','approved') and (new.manager_decisions is distinct from old.manager_decisions or new.director_decisions is distinct from old.director_decisions)) then
  perform 1 from public.students where id=new.student_id and tenant_id=new.tenant_id for update;
  perform 1 from public.enrollments where student_id=new.student_id and tenant_id=new.tenant_id for update;
  perform 1 from public.classes c join public.enrollments e on e.class_id=c.id where e.student_id=new.student_id and e.tenant_id=new.tenant_id for share of c;
  -- 퇴원 묶음은 학생 전체, 과목 수강종료 묶음은 학생 정보 + 묶음 과목의 수강(s2_0014) · 반 이름은 대조하지 않는다(s2_0020).
  cmp_subjects:=case when new.exit_kind='withdrawal' then null else coalesce((select g.subjects from public.withdrawal_report_groups g where g.id=new.group_id and g.tenant_id=new.tenant_id),new.subjects) end;
  if public.withdrawal_report_compare_key(public.withdrawal_report_snapshot(new.tenant_id,new.student_id),cmp_subjects) is distinct from public.withdrawal_report_compare_key(new.snapshot,cmp_subjects) then raise exception '요청 이후 학생·수강·담당 강사가 변경되었습니다. 관리자에게 요청을 다시 작성해 달라고 알려 주세요.'; end if;
 end if;
 return new;
end $function$;

create or replace function public.request_withdrawal_report_group(p_tenant uuid, p_actor uuid, p_payload jsonb)
 returns uuid
 language plpgsql
 set search_path to 'public'
as $function$
declare s public.students; actor public.users; snap jsonb; chosen text[]; teachers uuid[]; managers uuid[]; directors uuid[]:='{}';
 gid uuid; rid uuid; teacher uuid; recipient uuid; subjects_for_teacher text[]; d date; kind text; scope_row jsonb; targets uuid[]; teacher_targets uuid[];
begin
 select * into actor from public.users where id=p_actor and tenant_id=p_tenant and status='active';
 if actor.id is null or actor.system_role::text not in ('master','admin','manager') then raise exception '관리자가 작성 요청을 할 수 있습니다.'; end if;
 select * into s from public.students where tenant_id=p_tenant and id=(p_payload->>'studentId')::uuid for update;
 if s.id is null or s.status::text not in ('enrolled','on_hold') or s.withdrawn_at is not null then raise exception '재원·휴원 학생만 요청할 수 있습니다. 기존 퇴원 예약을 확인해 주세요.'; end if;
 perform 1 from public.enrollments where tenant_id=p_tenant and student_id=s.id for update;
 perform 1 from public.classes c join public.enrollments e on e.class_id=c.id where e.student_id=s.id and e.tenant_id=p_tenant for share of c;
 if exists(select 1 from public.withdrawal_reports where tenant_id=p_tenant and student_id=s.id and group_id is null and status not in ('completed','canceled')) then raise exception '이 학생의 진행 중인 보고서가 있습니다.'; end if;
 snap:=public.withdrawal_report_snapshot(p_tenant,s.id);
 if p_payload ? 'enrollmentIds' then
  if jsonb_typeof(p_payload->'enrollmentIds') is distinct from 'array' then raise exception '종료할 반을 선택해 주세요.'; end if;
  select array_agg(distinct v::uuid order by v::uuid) into targets from jsonb_array_elements_text(p_payload->'enrollmentIds') x(v);
  if coalesce(cardinality(targets),0) not between 1 and 100 or exists(select 1 from unnest(targets) x where not exists(select 1 from jsonb_array_elements(snap->'courses') e where (e->>'id')::uuid=x)) then raise exception '현재 학생이 수강 중인 반을 선택해 주세요.'; end if;
  select array_agg(distinct e->>'subject' order by e->>'subject') into chosen from jsonb_array_elements(snap->'courses') e where (e->>'id')::uuid=any(targets);
 else
  -- 배포 전에 열린 폼은 기존의 명시된 과목 범위를 유지한다.
  select array_agg(distinct v order by v) into chosen from jsonb_array_elements_text(p_payload->'subjects') x(v);
  select array_agg((e->>'id')::uuid order by e->>'id') into targets from jsonb_array_elements(snap->'courses') e where e->>'subject'=any(chosen);
 end if;
 if exists(select 1 from public.enrollments e join public.classes c on c.id=e.class_id where e.tenant_id=p_tenant and e.student_id=s.id and e.id=any(targets) and (not c.is_active or c.closed_at is not null)) then raise exception '종강되었거나 운영하지 않는 반은 선택할 수 없습니다. 반 목록을 새로고침해 주세요.'; end if; if exists(select 1 from public.withdrawal_report_groups g2 where g2.tenant_id=p_tenant and g2.student_id=s.id and g2.status not in ('completed','canceled') and (g2.exit_kind='withdrawal' or g2.subjects && chosen or cardinality(chosen)=0)) then raise exception '같은 과목의 퇴원보고서가 진행 중입니다. 그 보고서를 먼저 마무리해 주세요.'; end if;
 select array_agg(distinct v::uuid order by v::uuid) into teachers from jsonb_array_elements_text(p_payload->'teacherIds') x(v);
 select coalesce(array_agg(distinct v::uuid order by v::uuid),'{}') into managers from jsonb_array_elements_text(coalesce(p_payload->'managerIds','[]'::jsonb)) x(v);
 -- 원장 승인 단계는 없다(원장 2026-11-03) — 옛 화면이 보낸 directorIds는 받지 않는다(directors = 늘 빈 값).
 if coalesce(cardinality(chosen),0)=0 or coalesce(cardinality(teachers),0) not between 1 and 20 or cardinality(managers)>20 then raise exception '대상 과목·작성 강사·승인 관리자를 선택해 주세요.'; end if;
 -- 관리자 승인 생략(작성 강사가 그 과목 관리자 · 원장 2026-11-03)은 작성 강사가 모두 관리자급일 때만. 과목 관리자인지는 앱이 가린다.
 if cardinality(managers)=0 and exists(select 1 from unnest(teachers) x where not exists(select 1 from public.users where id=x and tenant_id=p_tenant and status='active' and system_role::text in ('admin','manager','master') and not coalesce(public.is_super_admin(id),false))) then raise exception '승인할 관리자를 선택해 주세요.'; end if;
 if teachers && managers then raise exception '작성자·관리자를 서로 다르게 지정해 주세요.'; end if;
 if exists(select 1 from unnest(chosen) x where not exists(select 1 from jsonb_array_elements(snap->'courses') e where e->>'subject'=x)) then raise exception '선택 과목의 수강을 찾을 수 없습니다.'; end if;
 if actor.system_role::text<>'master' and not coalesce(public.is_super_admin(actor.id),false) then
  select x into scope_row from public.tenant_settings ts,lateral jsonb_array_elements(coalesce(ts.data#>'{permissions,specialAccess,staffSubjectScopes}','[]')) x where ts.tenant_id=p_tenant and x->>'userId'=actor.id::text limit 1;
  if scope_row is not null and exists(select 1 from unnest(chosen) x where not coalesce(scope_row->'subjects','[]') ? x) then raise exception '담당 과목의 보고서만 요청할 수 있습니다.'; end if;
 end if;
 if exists(select 1 from unnest(teachers) x where not exists(select 1 from public.users where id=x and tenant_id=p_tenant and status='active' and system_role::text in ('teacher','admin','manager','master')) or not exists(select 1 from jsonb_array_elements(snap->'courses') e where e->>'teacherId'=x::text and (e->>'id')::uuid=any(targets))) then raise exception '선택한 수강의 담당 강사를 지정해 주세요.'; end if;
 -- 종료 대상은 선택한 모든 반, 작성자는 그중 지정한 강사만이다.
 if exists(select 1 from unnest(managers) x where not exists(select 1 from public.users where id=x and tenant_id=p_tenant and status='active' and system_role::text in ('admin','manager','master') and not coalesce(public.is_super_admin(id),false))) then raise exception '현재 재직 중인 승인 관리자를 선택해 주세요.'; end if;
 d:=(p_payload->>'effectiveDate')::date;
 if d is null or d<coalesce(s.enrolled_at,d) or d>(now() at time zone 'Asia/Seoul')::date+365 then raise exception '종료일은 등록일 이후, 오늘부터 1년 이내로 지정해 주세요.'; end if;
 kind:=case when exists(select 1 from jsonb_array_elements(snap->'courses') e where not (e->>'id')::uuid=any(targets) and exists(select 1 from public.classes c where c.id=(e->>'classId')::uuid and c.tenant_id=p_tenant and c.is_active and c.closed_at is null)) then 'subject_end' else 'withdrawal' end;
 insert into public.withdrawal_report_groups(tenant_id,student_id,requested_by,teacher_ids,manager_ids,director_ids,subjects,effective_date,exit_kind,snapshot,enrollment_ids)
 values(p_tenant,s.id,p_actor,teachers,managers,directors,chosen,d,kind,snap,targets) returning id into gid;
 foreach teacher in array teachers loop
  select array_agg(distinct e->>'subject'),array_agg((e->>'id')::uuid order by e->>'id') into subjects_for_teacher,teacher_targets from jsonb_array_elements(snap->'courses') e where (cardinality(teachers)=1 or e->>'teacherId'=teacher::text) and (e->>'id')::uuid=any(targets);
  -- 관리자 0명 묶음은 manager_id = null(managers[1]) · manager_ids = '{}'.
  insert into public.withdrawal_reports(tenant_id,student_id,requested_by,teacher_id,manager_id,director_id,manager_ids,director_ids,group_id,group_leader,subjects,effective_date,exit_kind,request_note,snapshot,enrollment_ids)
   values(p_tenant,s.id,p_actor,teacher,managers[1],null,managers,directors,gid,teacher=teachers[1],subjects_for_teacher,d,kind,coalesce(p_payload->>'note',''),snap,teacher_targets) returning id into rid;
  insert into public.withdrawal_report_events(tenant_id,report_id,actor_id,action,to_status) values(p_tenant,rid,p_actor,'request','requested');
  if teacher<>p_actor then insert into public.notifications(tenant_id,recipient_id,type,title,body,link,actor_id) values(p_tenant,teacher,'approval_requested','퇴원보고서 작성 요청',s.name||' · '||d::text,'/withdrawal-reports/'||rid::text,p_actor); end if;
 end loop;
 return gid;
end $function$;

-- ── 4) 처리 함수 ─────────────────────────────────────────────────────────────────────────────────────
create or replace function public.transition_withdrawal_report(p_tenant uuid, p_actor uuid, p_report uuid, p_action text, p_payload jsonb default '{}'::jsonb)
 returns public.withdrawal_reports
 language plpgsql
 set search_path to 'public'
as $function$
declare
 r public.withdrawal_reports; g public.withdrawal_report_groups; actor public.users; snap jsonb;
 gid uuid; prior text; recipient uuid; recipients uuid[]:='{}'; headline text; comment_text text;
 field text; child public.withdrawal_reports; valid boolean; targets uuid[]; affected integer; cmp_subjects text[]; all_approved boolean;
 today date:=(now() at time zone 'Asia/Seoul')::date;
begin
 if p_action='request' then
  perform 1 from public.students where tenant_id=p_tenant and id=(p_payload->>'studentId')::uuid for update;
  if exists(select 1 from public.withdrawal_report_groups where tenant_id=p_tenant and student_id=(p_payload->>'studentId')::uuid and status not in ('completed','canceled')) then raise exception '이 학생의 진행 중인 보고서가 있습니다.'; end if;
  return public.transition_withdrawal_report_v1(p_tenant,p_actor,p_report,p_action,p_payload);
 end if;
 select group_id into gid from public.withdrawal_reports where tenant_id=p_tenant and id=p_report;
 if gid is null then return public.transition_withdrawal_report_v1(p_tenant,p_actor,p_report,p_action,p_payload); end if;
 select * into g from public.withdrawal_report_groups where tenant_id=p_tenant and id=gid for update;
 select * into r from public.withdrawal_reports where tenant_id=p_tenant and id=p_report for update;
 prior:=r.status;
 if p_action not in ('save','submit','approve','reject','cancel','apply','release') then raise exception '지원하지 않는 처리입니다.'; end if;
 if p_action not in ('apply','release') then
  select * into actor from public.users where tenant_id=p_tenant and id=p_actor and status='active';
  if actor.id is null then raise exception '작업 권한을 확인할 수 없습니다.'; end if;
  if coalesce((p_payload->>'revision')::integer,0)<>r.revision then raise exception '보고서가 변경되었습니다. 새로고침 후 다시 진행해 주세요.'; end if;
 elsif p_action='release' and p_actor is not null then
  -- release = 데스크 환불 완료 뒤 처리 — 행위자는 환불 완료를 저장한 사람(시스템이면 null).
  select * into actor from public.users where tenant_id=p_tenant and id=p_actor and status='active';
  if actor.id is null then raise exception '작업 권한을 확인할 수 없습니다.'; end if;
 end if;
 if p_action in ('save','submit') then
  if r.teacher_id<>p_actor or r.status not in ('requested','revision') or g.status<>'pending' then raise exception '작성 요청을 받은 강사만 작성할 수 있습니다.'; end if;
  if jsonb_typeof(p_payload->'body') is distinct from 'object' then raise exception '보고서 본문을 확인해 주세요.'; end if;
  foreach field in array array['detail','studentConsultation','parentConsultation','teacherOpinion','attendance','tuition','arrearsNote'] loop
   if jsonb_typeof(p_payload->'body'->field) is distinct from 'string' or char_length(p_payload->'body'->>field)>5000 then raise exception '보고서 항목을 확인해 주세요.'; end if;
  end loop;
  if coalesce(p_payload->'body'->>'reason','') not in ('graduated','relocation','illness','competitor','financial','schedule','dissatisfaction','grades','motivation','method','career','peers','advised','other') or coalesce(p_payload->'body'->>'arrears','') not in ('unknown','yes','no') then raise exception '퇴원사유와 미납 여부를 확인해 주세요.'; end if;
  if p_action='submit' and (char_length(btrim(p_payload->'body'->>'detail'))<100 or btrim(p_payload->'body'->>'studentConsultation')='' or btrim(p_payload->'body'->>'parentConsultation')='' or btrim(p_payload->'body'->>'teacherOpinion')='') then raise exception '상세사유 100자 이상과 상담 결과·담임 의견을 작성해 주세요.'; end if;
  r.body:=p_payload->'body'; r.manager_decisions:='{}'; r.director_decisions:='{}'; r.manager_approved_at:=null; r.director_approved_at:=null; r.last_comment:=null;
  if p_action='submit' then
   if cardinality(g.manager_ids)=0 then
    -- 관리자 승인 생략(작성 강사가 그 과목 관리자 · 원장 2026-11-03) — 제출이 곧 관리자 승인이다.
    r.status:='approved'; r.manager_approved_at:=now(); recipients:=array[g.requested_by]; headline:='퇴원보고서 제출 · 관리자 승인 생략';
   else
    r.status:='manager_pending'; recipients:=g.manager_ids; headline:=case when cardinality(g.director_ids)=0 and not exists(select 1 from unnest(g.manager_ids) x where not exists(select 1 from public.users u where u.id=x and u.tenant_id=p_tenant and u.system_role::text='master')) then '퇴원보고서 원장 승인 요청' else '퇴원보고서 관리자 승인 요청' end;
   end if;
  end if;
 elsif p_action in ('approve','reject') then
  if g.status<>'pending' or not ((r.status='manager_pending' and p_actor=any(g.manager_ids) and not r.manager_decisions ? p_actor::text and actor.system_role::text in ('admin','manager','master')) or (r.status='director_pending' and p_actor=any(g.director_ids) and not r.director_decisions ? p_actor::text and actor.system_role::text='master' and not coalesce(public.is_super_admin(actor.id),false))) then raise exception '지정된 승인자의 순서가 아닙니다.'; end if;
  if p_action='reject' then
   comment_text:=btrim(coalesce(p_payload->>'comment',''));
   if char_length(comment_text) not between 1 and 1000 then raise exception '반려 사유를 1~1,000자로 작성해 주세요.'; end if;
   r.status:='revision'; r.last_comment:=comment_text; r.manager_decisions:='{}'; r.director_decisions:='{}'; r.manager_approved_at:=null; r.director_approved_at:=null;
   recipients:=array[r.teacher_id,g.requested_by]||g.manager_ids||g.director_ids; headline:='퇴원보고서 수정 요청';
  elsif r.status='manager_pending' then
   r.manager_decisions:=r.manager_decisions||jsonb_build_object(p_actor::text,now());
   if not exists(select 1 from unnest(g.manager_ids) x where not r.manager_decisions ? x::text) then
    r.manager_approved_at:=now();
    if cardinality(g.director_ids)=0 then r.status:='approved'; recipients:=array[r.teacher_id,g.requested_by]; headline:='퇴원보고서 승인 완료';
    else r.status:='director_pending'; recipients:=g.director_ids; headline:='퇴원보고서 원장 승인 요청'; end if;
   end if;
  else
   r.director_decisions:=r.director_decisions||jsonb_build_object(p_actor::text,now());
   if not exists(select 1 from unnest(g.director_ids) x where not r.director_decisions ? x::text) then r.director_approved_at:=now(); r.status:='approved'; recipients:=array[r.teacher_id,g.requested_by]||g.manager_ids; headline:='퇴원보고서 승인 완료'; end if;
  end if;
 elsif p_action='cancel' then
  if ((p_actor is distinct from g.requested_by) and not exists(select 1 from public.users u where u.tenant_id=p_tenant and u.id=p_actor and u.status='active' and u.system_role::text='master')) or g.status in ('completed','canceled') then raise exception '이 요청을 취소할 수 없습니다.'; end if;
  g.status:='canceled'; headline:='퇴원보고서 요청 취소';
 elsif p_action='apply' then
  if (p_actor is not null and not (r.direct and p_actor=g.requested_by)) or g.status<>'scheduled' or g.effective_date>today then raise exception '처리일이 된 승인 보고서만 처리할 수 있습니다.'; end if;
  -- 데스크 환불이 남은 예약은 처리일이 돼도 미룬다 — 오류 없이 그대로 돌려준다(앱 cron이 '미룸'으로 세고 다음 날 다시 · 환불 완료 때 release).
  if public.withdrawal_report_refund_pending(g.id) then return r; end if;
 elsif p_action='release' then
  if public.withdrawal_report_refund_pending(g.id) or not ((g.status='pending' and not exists(select 1 from public.withdrawal_reports q where q.group_id=g.id and q.status<>'approved')) or (g.status='scheduled' and g.effective_date<=today)) then raise exception '데스크 환불이 끝난 승인 완료 보고서만 처리할 수 있습니다.'; end if;
 end if;
 update public.withdrawal_reports set body=r.body,status=r.status,manager_decisions=r.manager_decisions,director_decisions=r.director_decisions,
  manager_approved_at=r.manager_approved_at,director_approved_at=r.director_approved_at,last_comment=r.last_comment,revision=revision+1,updated_at=now() where id=r.id;
 all_approved:=r.status='approved' and p_action in ('approve','submit') and not exists(select 1 from public.withdrawal_reports where group_id=g.id and status<>'approved');
 if all_approved and public.withdrawal_report_refund_pending(g.id) then
  -- 승인은 모두 끝났고 데스크 환불만 남았다 — 묶음은 기다린다(원장 2026-11-03 '데스크 환불 요청' 단계). 환불 완료 때 release가 처리한다.
  recipients:=array[r.teacher_id,g.requested_by]; headline:='퇴원보고서 승인 완료 · 데스크 환불 대기';
 elsif all_approved or p_action in ('apply','release') then
  perform 1 from public.students where id=g.student_id and tenant_id=p_tenant for update;
  perform 1 from public.enrollments where tenant_id=p_tenant and student_id=g.student_id for update;
  perform 1 from public.classes c join public.enrollments e on e.class_id=c.id where e.student_id=g.student_id and e.tenant_id=p_tenant for share of c;
  snap:=public.withdrawal_report_snapshot(p_tenant,g.student_id);
  -- 퇴원 묶음은 학생 전체, 과목 수강종료 묶음은 학생 정보 + 자기 과목 수강(s2_0014) · 반 이름은 대조하지 않는다(s2_0020).
  cmp_subjects:=case when g.exit_kind='withdrawal' then null else g.subjects end;
  valid:=public.withdrawal_report_compare_key(snap,cmp_subjects) is not distinct from public.withdrawal_report_compare_key(g.snapshot,cmp_subjects)
   and not exists(select 1 from public.enrollments e join public.classes c on c.id=e.class_id where e.tenant_id=p_tenant and e.student_id=g.student_id and e.id=any(g.enrollment_ids) and (not c.is_active or c.closed_at is not null))
   and (select count(*) from public.withdrawal_reports where group_id=g.id)=cardinality(g.teacher_ids)
   and not exists(select 1 from public.withdrawal_reports q where q.group_id=g.id and (q.status not in ('approved','scheduled') or exists(select 1 from unnest(g.manager_ids) x where not q.manager_decisions ? x::text) or exists(select 1 from unnest(g.director_ids) x where not q.director_decisions ? x::text)))
   and not exists(select 1 from unnest(g.manager_ids) x where not exists(select 1 from public.users where id=x and tenant_id=p_tenant and status='active' and system_role::text in ('admin','manager','master')))
   and not exists(select 1 from unnest(g.director_ids) x where not exists(select 1 from public.users where id=x and tenant_id=p_tenant and status='active' and system_role::text='master' and not coalesce(public.is_super_admin(id),false)))
   and not exists(select 1 from unnest(g.teacher_ids) x where not exists(select 1 from public.users where id=x and tenant_id=p_tenant and status='active' and system_role::text in ('teacher','admin','manager','master')))
   -- 관리자 0명 묶음은 작성 강사가 승인자 몫이다 — 아직 관리자급인지 본다.
   and (cardinality(g.manager_ids)>0 or not exists(select 1 from unnest(g.teacher_ids) x where not exists(select 1 from public.users where id=x and tenant_id=p_tenant and status='active' and system_role::text in ('admin','manager','master'))));
  if not coalesce(valid,false) then
   if p_action not in ('apply','release') then raise exception '요청 이후 학생·수강·승인자 정보가 변경되었습니다. 요청을 취소한 뒤 다시 작성해 주세요.'; end if;
   g.status:='blocked'; headline:='퇴원보고서 재검토 필요';
   comment_text:='승인 이후 학생·수강·승인자 정보가 변경되어 자동 처리를 멈췄습니다. 요청을 취소한 뒤 다시 작성해 주세요.';
  elsif g.effective_date>today then g.status:='scheduled'; headline:='퇴원보고서 전체 승인 완료';
  else
   targets:=g.enrollment_ids;
   if targets is null then raise exception '종료할 반을 확인하지 못했습니다. 요청 내용을 다시 확인해 주세요.'; end if;
   if coalesce(cardinality(targets),0)=0 and not (r.direct and g.exit_kind='withdrawal') then raise exception '종료할 수강을 찾을 수 없습니다.'; end if;
   update public.enrollments e set end_date=greatest(e.start_date,g.effective_date),is_transferred=false,
    withdrawal_reason=(select q.body->>'reason' from public.withdrawal_reports q join public.classes c on c.id=e.class_id where q.group_id=g.id order by coalesce(e.id=any(q.enrollment_ids),false) desc,q.group_leader desc,q.id limit 1),
    withdrawal_detail=(select nullif(q.body->>'reasonDetail','') from public.withdrawal_reports q join public.classes c on c.id=e.class_id where q.group_id=g.id order by coalesce(e.id=any(q.enrollment_ids),false) desc,q.group_leader desc,q.id limit 1),
    withdrawal_memo=(select nullif(btrim(q.body->>'detail'),'') from public.withdrawal_reports q join public.classes c on c.id=e.class_id where q.group_id=g.id order by coalesce(e.id=any(q.enrollment_ids),false) desc,q.group_leader desc,q.id limit 1)
    where e.tenant_id=p_tenant and e.student_id=g.student_id and e.id=any(targets);
   get diagnostics affected=row_count;
   if affected<>cardinality(targets) then raise exception '수강 정보가 변경되었습니다. 다시 확인해 주세요.'; end if;
   if g.exit_kind<>'withdrawal' and not exists(select 1 from public.enrollments e join public.classes c on c.id=e.class_id and c.tenant_id=p_tenant where e.tenant_id=p_tenant and e.student_id=g.student_id and not e.id=any(coalesce(targets,'{}'::uuid[])) and c.is_active and c.closed_at is null and (e.end_date is null or e.end_date>greatest(g.effective_date,today))) then g.exit_kind:='withdrawal'; update public.withdrawal_report_groups set exit_kind='withdrawal' where id=g.id; update public.withdrawal_reports set exit_kind='withdrawal' where group_id=g.id; end if; if g.exit_kind='withdrawal' then
    update public.students set status='withdrawn',withdrawn_at=g.effective_date,
     withdrawal_metadata=(select jsonb_build_object('reason',q.body->>'reason','detail',nullif(q.body->>'reasonDetail',''),'memo',q.body->>'detail','reportId',q.id,'reportGroupId',g.id,'reportIds',(select jsonb_agg(id order by id) from public.withdrawal_reports where group_id=g.id),'consultation',jsonb_build_object('adminCalledParent',false,'teacherCalledParent',false,'talkedWithStudent',false)) from public.withdrawal_reports q where q.group_id=g.id and q.group_leader)
     where tenant_id=p_tenant and id=g.student_id;
   end if;
   g.status:='completed'; g.applied_at:=now(); headline:='퇴원·수강종료 처리 완료';
  end if;
 end if;
 if g.status in ('scheduled','completed','blocked','canceled') then
  -- Each child keeps a complete audit trail and its own notification link.
  for child in select * from public.withdrawal_reports where group_id=g.id order by id loop
   update public.withdrawal_reports set status=g.status,applied_at=g.applied_at,last_comment=coalesce(comment_text,last_comment),revision=revision+1,updated_at=now() where id=child.id;
   insert into public.withdrawal_report_events(tenant_id,report_id,actor_id,action,from_status,to_status,comment) values(p_tenant,child.id,p_actor,p_action,child.status,g.status,comment_text);
   for recipient in select distinct x from unnest(array[g.requested_by,child.teacher_id]||g.manager_ids||g.director_ids) x where x<>coalesce(p_actor,'00000000-0000-0000-0000-000000000000') loop
    insert into public.notifications(tenant_id,recipient_id,type,title,body,link,actor_id) values(p_tenant,recipient,'approval_decided',headline,g.snapshot->>'name'||' · '||g.effective_date::text,'/withdrawal-reports/'||child.id::text,p_actor);
   end loop;
  end loop;
  update public.withdrawal_report_groups set status=g.status,applied_at=g.applied_at where id=g.id;
 else
  insert into public.withdrawal_report_events(tenant_id,report_id,actor_id,action,from_status,to_status,body,comment) values(p_tenant,r.id,p_actor,p_action,prior,r.status,case when p_action in ('submit','approve','reject') then r.body end,comment_text);
  for recipient in select distinct x from unnest(recipients) x where x<>coalesce(p_actor,'00000000-0000-0000-0000-000000000000') loop
   insert into public.notifications(tenant_id,recipient_id,type,title,body,link,actor_id) values(p_tenant,recipient,'approval_requested',headline,g.snapshot->>'name'||' · '||g.effective_date::text,'/withdrawal-reports/'||r.id::text,p_actor);
  end loop;
 end if;
 select * into r from public.withdrawal_reports where id=r.id;
 return r;
end $function$;

-- 옛 단건 처리 함수(_v1)의 대조도 반 이름을 빼고(진행 중 옛 단건 0건 · 같은 규칙으로 맞춘다). 그 줄 하나만 바꾼다.
do $$
declare
  definition text;
  o constant text := 'if snap is distinct from r.snapshot or';
  hits int;
begin
  select pg_get_functiondef('public.transition_withdrawal_report_v1(uuid,uuid,uuid,text,jsonb)'::regprocedure) into definition;
  hits := (length(definition) - length(replace(definition, o, ''))) / length(o);
  if hits <> 1 then raise exception 's2_0020: _v1 대조 줄이 하나가 아닙니다(%건)', hits; end if;
  execute replace(definition, o, 'if public.withdrawal_report_compare_key(snap,null) is distinct from public.withdrawal_report_compare_key(r.snapshot,null) or');
end $$;

-- ── 5) 환불이 끝난 묶음 처리 — 수납의 환불완료 저장·요청서 삭제(그 요청서) · 처리일 cron(전체) ───────────────────────────────
create or replace function public.release_withdrawal_report_refunds(p_tenant uuid, p_document uuid, p_actor uuid)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  x record; res public.withdrawal_reports; out jsonb := '[]'::jsonb; today date := (now() at time zone 'Asia/Seoul')::date;
begin
  for x in
    select g.id gid, g.tenant_id tid,
      (select q.id from public.withdrawal_reports q where q.group_id = g.id order by q.group_leader desc, q.id limit 1) rid
      from public.withdrawal_report_groups g
     where (p_tenant is null or g.tenant_id = p_tenant)
       and exists(select 1 from public.withdrawal_report_refunds f where f.group_id = g.id and (p_document is null or f.document_id = p_document))
       and ((g.status = 'pending' and not exists(select 1 from public.withdrawal_reports q where q.group_id = g.id and q.status <> 'approved'))
            or (g.status = 'scheduled' and g.effective_date <= today))
       and not public.withdrawal_report_refund_pending(g.id)
     order by g.created_at
     limit 200
  loop
    begin
      res := public.transition_withdrawal_report(x.tid, case when p_tenant is null then null else p_actor end, x.rid, 'release', '{}'::jsonb);
      out := out || jsonb_build_array(jsonb_build_object('reportId', res.id, 'groupId', x.gid, 'tenantId', x.tid, 'status', res.status));
    exception when others then
      -- 한 묶음의 실패가 다른 묶음을 막지 않는다(그 묶음만 되돌린다) — 앱이 오류 보고로 넘긴다.
      out := out || jsonb_build_array(jsonb_build_object('reportId', x.rid, 'groupId', x.gid, 'tenantId', x.tid, 'error', sqlerrm));
    end;
  end loop;
  return out;
end $$;
revoke all on function public.release_withdrawal_report_refunds(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.release_withdrawal_report_refunds(uuid, uuid, uuid) to service_role;

notify pgrst, 'reload schema';
commit;
