-- s2_0032 되돌리기 — 원장 환불 결정 단계·데스크 지정 검사·완료 입력 트리거를 걷고 s2_0032 적용 전(= s2_0030 적용 뒤) 정의로 돌린다.
-- 🔴 앱을 먼저 되돌린 뒤 쓴다(새 앱은 결정 함수·4인자 release·8인자 연결을 부른다). 되돌리면 환불할 줄이 남아도 마지막 승인에 바로 처리되는 종전 동작으로 돌아간다.
-- 멈추는 경우: 지문이 s2_0032 적용 뒤가 아니다 · 진행 중 '환불 결정 대기' 묶음이 있다 · 승인이 다 끝났는데 처리하지 않은 묶음(데스크 환불 대기 제외)이 있다
--   (되돌린 옛 처리 함수는 마지막 승인 순간에만 처리하므로 그 묶음을 처리할 길이 없다 — 원장 결정·처리·취소로 정리한 뒤 되돌린다).
-- 무엇: transition_withdrawal_report = s2_0030 본문 그대로 · _v1·할 일 동기화 = s2_0032 치환을 거꾸로(정확히 한 번 · 줄바꿈 글자 차이는 지우고 맞춘다) ·
--   attach(6인자)·release(3인자) = s2_0025 본문 그대로(운영 정의와 지문이 같다) · 결정 함수·표시 함수·완료 입력 트리거를 지운다.
--   결정 표(withdrawal_report_refund_decisions)와 묶음 칸 넷은 남긴다(데이터 보존 · 옛 함수는 읽지 않는다 · 다시 적용하면 그대로 쓴다).
-- 되돌린 뒤 다섯 함수가 s2_0032 적용 전 지문인지 다시 보고, 아니면 거래 전체를 취소한다.
-- 적용할 때: 기본 search_path 세션에서 begin…commit 그대로 실행한다(빈 search_path면 지문이 달라져 멈춘다 — 안전한 쪽 실패). 중간에 실패하면 ROLLBACK.
-- 확인(로컬 PGlite 0.3.16 · PG 17.5 · 운영 정의를 올려서): 운영 정의 → s2_0030 → s2_0032 → 이 파일 → 다섯 함수 지문이 s2_0032 적용 전과 같다 ·
--   다시 s2_0032을 적용할 수 있다.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- s2_0032 적용 뒤 지문일 때만 되돌린다.
do $$
declare
  want constant jsonb := jsonb_build_object(
    'public.transition_withdrawal_report(uuid,uuid,uuid,text,jsonb)', 'f122700633df18f0f784453843816027',
    'public.transition_withdrawal_report_v1(uuid,uuid,uuid,text,jsonb)', 'c8d87498a853195d7c86de12b21ae6d8',
    'public.attach_withdrawal_report_refund(uuid,uuid,uuid,uuid,uuid,boolean,jsonb,jsonb)', 'a8db90811a3a6ab1a15efbc4d1540c18',
    'public.release_withdrawal_report_refunds(uuid,uuid,uuid,jsonb)', '2516d0340b850c14faa4f91e9ea673ca',
    'staff_tasks_private.withdrawal_sync_report(uuid)', '577ba3f3c9f2c429b051b8656a660cb0',
    'public.withdrawal_report_refund_note(uuid,uuid,jsonb,uuid,boolean)', '68a2408187a7c53c87d9ee3787fd1734',
    'public.decide_withdrawal_report_refund(uuid,uuid,uuid,jsonb,jsonb)', '5d2702c73c9f625ab25384aeb8e5a572',
    'public.withdrawal_report_refund_complete_guard()', 'cb6524d746a305a5931abe3ede48d982');
  fn text;
  got text;
begin
  for fn in select jsonb_object_keys(want) loop
    select md5(regexp_replace(pg_get_functiondef(fn::regprocedure), '[[:space:]]+', '', 'g')) into got;
    if got is distinct from want->>fn then
      raise exception 'revert-s2_0032: % 의 정의가 s2_0032 적용 뒤와 다릅니다(%). 되돌리지 않습니다.', fn, got;
    end if;
  end loop;
end $$;

-- 진행 중인 '환불 결정 대기'가 있거나, 승인이 다 끝났는데 처리하지 않은 묶음(데스크 환불 대기는 빼고)이 있으면 멈춘다 —
-- 되돌리면 그 묶음을 처리할 길이 없다(옛 처리는 마지막 승인 순간에만 처리한다). 원장 결정·취소로 정리한 뒤 되돌린다.
do $$
declare
  held integer;
  stuck integer;
begin
  select count(*) into held from public.withdrawal_report_groups where refund_hold and status in ('pending', 'scheduled');
  select count(*) into stuck from public.withdrawal_report_groups g
   where g.status = 'pending' and not exists(select 1 from public.withdrawal_reports q where q.group_id = g.id and q.status <> 'approved')
     and not public.withdrawal_report_refund_pending(g.id);
  if held > 0 or stuck > 0 then
    raise exception 'revert-s2_0032: 환불 결정 대기 묶음 %건 · 승인이 끝났는데 처리하지 않은 묶음 %건이 있습니다. 원장 결정·처리·취소로 정리한 뒤 되돌리세요.', held, stuck;
  end if;
end $$;

-- 처리 함수 = s2_0030 본문 그대로.
create or replace function public.transition_withdrawal_report(p_tenant uuid, p_actor uuid, p_report uuid, p_action text, p_payload jsonb default '{}'::jsonb)
 returns public.withdrawal_reports
 language plpgsql
 set search_path to 'public'
as $function$
declare
 r public.withdrawal_reports; g public.withdrawal_report_groups; actor public.users; snap jsonb;
 gid uuid; prior text; recipient uuid; recipients uuid[]:='{}'; headline text; comment_text text;
 field text; child public.withdrawal_reports; valid boolean; targets uuid[]; affected integer; cmp_subjects text[]; all_approved boolean; mgrs uuid[];
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
 -- 이 보고서의 승인 관리자(s2_0025 — 보고서마다 · 옛 보고서는 묶음 것). 빈 목록 = 관리자 승인 생략.
 mgrs:=coalesce(r.manager_ids,g.manager_ids);
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
  -- 반려 사유는 **다시 제출할 때** 지운다(원장 2026-11-05 실시간 저장 — 자동 저장이 한 글자마다 'save'라, 저장에서 지우면 반려 배너가
  -- 첫 글자에 사라졌다. 고쳐 쓰는 동안 사유를 보고 쓴다).
  r.body:=p_payload->'body'; r.manager_decisions:='{}'; r.director_decisions:='{}'; r.manager_approved_at:=null; r.director_approved_at:=null;
  if p_action='submit' then r.last_comment:=null; end if;
  if p_action='submit' then
   if cardinality(mgrs)=0 then
    -- 관리자 승인 생략(작성 강사가 그 보고서 과목의 관리자 · 원장 2026-11-03) — 제출이 곧 관리자 승인이다.
    r.status:='approved'; r.manager_approved_at:=now(); recipients:=array[g.requested_by]; headline:='퇴원보고서 제출 · 관리자 승인 생략';
   else
    r.status:='manager_pending'; recipients:=mgrs; headline:='퇴원보고서 관리자 승인 요청';
   end if;
  end if;
 elsif p_action in ('approve','reject') then
  if g.status<>'pending' or not ((r.status='manager_pending' and p_actor=any(mgrs) and not r.manager_decisions ? p_actor::text and actor.system_role::text in ('admin','manager') and not coalesce(public.is_super_admin(actor.id),false)) or (r.status='director_pending' and p_actor=any(g.director_ids) and not r.director_decisions ? p_actor::text and actor.system_role::text='master' and not coalesce(public.is_super_admin(actor.id),false))) then raise exception '지정된 승인자의 순서가 아닙니다.'; end if;
  if p_action='reject' then
   comment_text:=btrim(coalesce(p_payload->>'comment',''));
   if char_length(comment_text) not between 1 and 1000 then raise exception '반려 사유를 1~1,000자로 작성해 주세요.'; end if;
   r.status:='revision'; r.last_comment:=comment_text; r.manager_decisions:='{}'; r.director_decisions:='{}'; r.manager_approved_at:=null; r.director_approved_at:=null;
   recipients:=array[r.teacher_id,g.requested_by]||mgrs||g.director_ids; headline:='퇴원보고서 수정 요청';
  elsif r.status='manager_pending' then
   r.manager_decisions:=r.manager_decisions||jsonb_build_object(p_actor::text,now());
   if not exists(select 1 from unnest(mgrs) x where not r.manager_decisions ? x::text) then
    r.manager_approved_at:=now();
    if cardinality(g.director_ids)=0 then r.status:='approved'; recipients:=array[r.teacher_id,g.requested_by]; headline:='퇴원보고서 승인 완료';
    else r.status:='director_pending'; recipients:=g.director_ids; headline:='퇴원보고서 원장 승인 요청'; end if;
   end if;
  else
   r.director_decisions:=r.director_decisions||jsonb_build_object(p_actor::text,now());
   if not exists(select 1 from unnest(g.director_ids) x where not r.director_decisions ? x::text) then r.director_approved_at:=now(); r.status:='approved'; recipients:=array[r.teacher_id,g.requested_by]||mgrs; headline:='퇴원보고서 승인 완료'; end if;
  end if;
 elsif p_action='cancel' then
  if ((p_actor is distinct from g.requested_by) and not exists(select 1 from public.users u where u.tenant_id=p_tenant and u.id=p_actor and u.status='active' and u.system_role::text='master')) or g.status in ('completed','canceled') then raise exception '이 요청을 취소할 수 없습니다.'; end if;
  g.status:='canceled'; headline:='퇴원보고서 요청 취소';
  -- 연결된 미완료 환불 요청서 — 데스크 할 일 취소 · 데스크 담당자에게 '환불 진행 전 확인'(요청서는 남긴다).
  perform public.withdrawal_report_refunds_on_cancel(p_tenant,g.id,p_actor,g.snapshot->>'name');
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
  recipients:=array[r.teacher_id,g.requested_by]; headline:='퇴원보고서 데스크 환불 요청';
 elsif all_approved or p_action in ('apply','release') then
  perform 1 from public.students where id=g.student_id and tenant_id=p_tenant for update;
  perform 1 from public.enrollments where tenant_id=p_tenant and student_id=g.student_id for update;
  perform 1 from public.classes c join public.enrollments e on e.class_id=c.id where e.student_id=g.student_id and e.tenant_id=p_tenant for share of c;
  snap:=public.withdrawal_report_snapshot(p_tenant,g.student_id);
  -- 퇴원 묶음은 학생 전체, 과목 수강종료 묶음은 학생 정보 + 자기 과목 수강(s2_0014) · 표시용 칸은 대조하지 않는다(s2_0025).
  cmp_subjects:=case when g.exit_kind='withdrawal' then null else g.subjects end;
  valid:=public.withdrawal_report_compare_key(snap,cmp_subjects) is not distinct from public.withdrawal_report_compare_key(g.snapshot,cmp_subjects)
   and not exists(select 1 from public.enrollments e join public.classes c on c.id=e.class_id where e.tenant_id=p_tenant and e.student_id=g.student_id and e.id=any(g.enrollment_ids) and (not c.is_active or c.closed_at is not null))
   and (select count(*) from public.withdrawal_reports where group_id=g.id)=cardinality(g.teacher_ids)
   and not exists(select 1 from public.withdrawal_reports q where q.group_id=g.id and (q.status not in ('approved','scheduled') or exists(select 1 from unnest(coalesce(q.manager_ids,g.manager_ids)) x where not q.manager_decisions ? x::text) or exists(select 1 from unnest(g.director_ids) x where not q.director_decisions ? x::text)))
   -- 승인 관리자는 관리자·매니저(원장급·운영자 계정 아님 · s2_0030). 바로 처리 보고서는 처리한 사람이 승인 칸이라 종전대로 둔다(원장·운영자 바로 처리 그대로).
   and not exists(select 1 from public.withdrawal_reports q, unnest(coalesce(q.manager_ids,g.manager_ids)) x where q.group_id=g.id and not exists(select 1 from public.users where id=x and tenant_id=p_tenant and status='active' and system_role::text in ('admin','manager','master') and (q.direct or (system_role::text<>'master' and not coalesce(public.is_super_admin(id),false)))))
   and not exists(select 1 from unnest(g.director_ids) x where not exists(select 1 from public.users where id=x and tenant_id=p_tenant and status='active' and system_role::text='master' and not coalesce(public.is_super_admin(id),false)))
   and not exists(select 1 from unnest(g.teacher_ids) x where not exists(select 1 from public.users where id=x and tenant_id=p_tenant and status='active' and system_role::text in ('teacher','admin','manager','master')))
   -- 관리자 승인을 생략한 보고서는 작성 강사가 승인자 몫이다 — 아직 관리자·매니저(원장급·운영자 계정 아님)인지 본다(요청 때와 같은 조건 · s2_0030).
   and not exists(select 1 from public.withdrawal_reports q where q.group_id=g.id and cardinality(coalesce(q.manager_ids,g.manager_ids))=0 and not exists(select 1 from public.users where id=q.teacher_id and tenant_id=p_tenant and status='active' and system_role::text in ('admin','manager') and not coalesce(public.is_super_admin(id),false)));
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
   -- 받는 사람 = 요청자 · 그 보고서 작성 강사 · **그 보고서의** 승인 관리자(묶음 합집합이면 다른 과목 관리자에게 무관한 링크가 간다) · 옛 원장.
   for recipient in select distinct x from unnest(array[g.requested_by,child.teacher_id]||coalesce(child.manager_ids,g.manager_ids)||g.director_ids) x where x<>coalesce(p_actor,'00000000-0000-0000-0000-000000000000') loop
    insert into public.notifications(tenant_id,recipient_id,type,title,body,link,actor_id) values(p_tenant,recipient,'approval_decided',headline,g.snapshot->>'name'||' · '||g.effective_date::text,'/withdrawal-reports/'||child.id::text,p_actor);
   end loop;
  end loop;
  update public.withdrawal_report_groups set status=g.status,applied_at=g.applied_at where id=g.id;
 else
  -- 자동 저장(원장 2026-11-05 "실시간으로 입력되고 저장되게") — 마지막 이력이 같은 사람의 10분 안 '임시 저장'이면 새 줄을 넣지 않는다
  -- (이력 표는 덧붙임 전용 — 고치지 않고 건너뛴다. 본문·revision은 위에서 이미 저장했다).
  if not (p_action='save' and exists(select 1 from (select e.action,e.actor_id,e.created_at from public.withdrawal_report_events e where e.tenant_id=p_tenant and e.report_id=r.id order by e.created_at desc,e.id desc limit 1) last
          where last.action='save' and last.actor_id is not distinct from p_actor and last.created_at>now()-interval '10 minutes')) then
   insert into public.withdrawal_report_events(tenant_id,report_id,actor_id,action,from_status,to_status,body,comment) values(p_tenant,r.id,p_actor,p_action,prior,r.status,case when p_action in ('submit','approve','reject') then r.body end,comment_text);
  end if;
  for recipient in select distinct x from unnest(recipients) x where x<>coalesce(p_actor,'00000000-0000-0000-0000-000000000000') loop
   insert into public.notifications(tenant_id,recipient_id,type,title,body,link,actor_id) values(p_tenant,recipient,'approval_requested',headline,g.snapshot->>'name'||' · '||g.effective_date::text,'/withdrawal-reports/'||r.id::text,p_actor);
  end loop;
 end if;
 select * into r from public.withdrawal_reports where id=r.id;
 return r;
end $function$;

-- 옛 단건(_v1) — 받는 처리 줄을 거꾸로 치환한다(정확히 한 번).
do $$
declare
  definition text;
  pairs constant text[] := array[
    $n$if p_action not in ('save','submit','reject','cancel') then raise exception '옛 단건 퇴원보고서는 작성·제출·반려·취소만 할 수 있습니다. 요청을 취소한 뒤 작성 요청 창에서 다시 요청해 주세요.'; end if;$n$,
    $o$if p_action not in ('request','save','submit','approve','reject','cancel','apply') then raise exception '지원하지 않는 처리입니다.'; end if;$o$];
  hits int;
  needle text;
begin
  select replace(pg_get_functiondef('public.transition_withdrawal_report_v1(uuid,uuid,uuid,text,jsonb)'::regprocedure), chr(13), '') into definition;
  for i in 1 .. array_length(pairs, 1) / 2 loop
    needle := replace(pairs[2*i-1], chr(13), '');
    hits := (length(definition) - length(replace(definition, needle, ''))) / length(needle);
    if hits <> 1 then raise exception 'revert-s2_0032: _v1의 되돌릴 줄 %번이 하나가 아닙니다(%건)', i, hits; end if;
    definition := replace(definition, needle, replace(pairs[2*i], chr(13), ''));
  end loop;
  execute definition;
end $$;

-- 할 일 동기화 — 세 줄을 거꾸로 치환한다(정확히 한 번). 열려 있던 원장 '환불 결정' 할 일은 남는다(위 검사로 진행 중 대기는 0건).
do $$
declare
  definition text;
  pairs constant text[] := array[
    $n$  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_refund_hold boolean;
  v_refund_settled boolean;$n$,
    $o$  v_today date := (now() at time zone 'Asia/Seoul')::date;$o$,
    $n$  select coalesce(g.refund_hold, false) and g.status in ('pending', 'scheduled') and g.refund_hold_report = r.id and r.status not in ('canceled', 'completed', 'blocked'),
         not coalesce(g.refund_hold, false) and g.status <> 'canceled' and r.status <> 'canceled'
    into v_refund_hold, v_refund_settled
    from public.withdrawal_report_groups g where g.id = r.group_id and g.tenant_id = r.tenant_id;
  if coalesce(v_refund_hold, false) then
    for v_user in select u.id from public.users u
        where u.tenant_id = r.tenant_id and u.status = 'active' and u.system_role::text = 'master' and not coalesce(public.is_super_admin(u.id), false) order by u.id loop
      v_cycle := 'refund:' || v_user::text;
      v_want := v_want || v_cycle;
      perform staff_tasks_private.open_task(r.tenant_id, 'withdrawal_step', r.id, v_cycle,
        '퇴원보고서 환불 결정', v_student || ' · 원장 환불 결정 차례',
        '/withdrawal-reports/' || r.id::text, ((v_today + 1)::timestamp at time zone 'Asia/Seoul'), array[v_user], null);
    end loop;
  end if;
  for x in$n$,
    $o$  for x in$o$,
    $n$    v_user := nullif(split_part(x.cycle, ':', 2), '')::uuid;
    if v_stage = 'refund' then
      v_n := v_n + staff_tasks_private.close_task(r.tenant_id, 'withdrawal_step', r.id, x.cycle,
        case when coalesce(v_refund_settled, false) then 'done' else 'cancelled' end,
        case when coalesce(v_refund_settled, false) then 'refund_settled' when r.status = 'canceled' then 'withdrawal_canceled' else 'turn_changed' end, null);
      continue;
    end if;$n$,
    $o$    v_user := nullif(split_part(x.cycle, ':', 2), '')::uuid;$o$];
  hits int;
  needle text;
begin
  select replace(pg_get_functiondef('staff_tasks_private.withdrawal_sync_report(uuid)'::regprocedure), chr(13), '') into definition;
  for i in 1 .. array_length(pairs, 1) / 2 loop
    needle := replace(pairs[2*i-1], chr(13), '');
    hits := (length(definition) - length(replace(definition, needle, ''))) / length(needle);
    if hits <> 1 then raise exception 'revert-s2_0032: 할 일 동기화의 되돌릴 줄 %번이 하나가 아닙니다(%건)', i, hits; end if;
    definition := replace(definition, needle, replace(pairs[2*i], chr(13), ''));
  end loop;
  execute definition;
end $$;

-- 데스크 연결 = s2_0025 본문(6인자) · release = s2_0025 본문(3인자). 실행 권한도 그때처럼.
drop function public.attach_withdrawal_report_refund(uuid, uuid, uuid, uuid, uuid, boolean, jsonb, jsonb);
create or replace function public.attach_withdrawal_report_refund(p_tenant uuid, p_actor uuid, p_report uuid, p_document uuid, p_desk uuid, p_expect_gate boolean)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  gid uuid; g public.withdrawal_report_groups; r public.withdrawal_reports; doc_description text; desk_name text; gates boolean := false; link uuid;
begin
  if not exists(select 1 from public.users where tenant_id = p_tenant and id = p_actor and status = 'active') then raise exception '작업 권한을 확인할 수 없습니다.'; end if;
  -- 처리 함수와 같은 잠금 순서(묶음 → 보고서).
  select group_id into gid from public.withdrawal_reports where tenant_id = p_tenant and id = p_report;
  if gid is not null then select * into g from public.withdrawal_report_groups where tenant_id = p_tenant and id = gid for update; end if;
  select * into r from public.withdrawal_reports where tenant_id = p_tenant and id = p_report for update;
  if r.id is null or r.status = 'canceled' or g.status = 'canceled' then raise exception '환불을 연결할 수 있는 퇴원보고서가 아닙니다.'; end if;
  select description into doc_description from public.academy_documents where tenant_id = p_tenant and id = p_document and form_type = 'refund_request';
  if doc_description is null or position(('report:' || p_report::text || ' ') in doc_description) = 0 then raise exception '이 보고서에서 만든 환불 요청서가 아닙니다.'; end if;
  if p_desk is not null then
    select display_name into desk_name from public.users where tenant_id = p_tenant and id = p_desk and status = 'active';
    if desk_name is null then raise exception '데스크 담당자를 다시 골라 주세요.'; end if;
  end if;
  -- 묶음이 아직 처리 전(진행 중 · 처리 예약)이면 이 환불이 끝나야 처리한다. 끝난 보고서에 붙인 환불은 기다리게 하지 않는다.
  gates := gid is not null and g.status in ('pending', 'scheduled');
  if p_expect_gate is not null and gates is distinct from p_expect_gate then
    raise exception '퇴원보고서가 그 사이 ''%'' 상태가 되었습니다. 새로고침 후 다시 확인해 주세요.',
      case coalesce(g.status, r.status) when 'completed' then '처리 완료' when 'blocked' then '재검토 필요' when 'scheduled' then '처리 예약' when 'pending' then '진행 중' else coalesce(g.status, r.status) end;
  end if;
  insert into public.withdrawal_report_refunds(tenant_id, report_id, group_id, document_id, desk_id, created_by)
    values (p_tenant, r.id, gid, p_document, p_desk, p_actor) on conflict (document_id) do nothing returning id into link;
  if link is null then raise exception '이미 연결된 환불 요청서입니다.'; end if;
  insert into public.withdrawal_report_events(tenant_id, report_id, actor_id, action, from_status, to_status, comment)
    values (p_tenant, r.id, p_actor, 'refund', r.status, r.status,
      '데스크 환불 요청' || coalesce(' · ' || desk_name, '') || case when gates then ' — 환불 처리(환불완료일자) 뒤 퇴원·수강종료' else '' end);
  return jsonb_build_object('attached', true, 'groupId', gid, 'groupStatus', g.status, 'gates', gates);
end $$;
revoke all on function public.attach_withdrawal_report_refund(uuid, uuid, uuid, uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.attach_withdrawal_report_refund(uuid, uuid, uuid, uuid, uuid, boolean) to service_role;
drop function public.release_withdrawal_report_refunds(uuid, uuid, uuid, jsonb);
create or replace function public.release_withdrawal_report_refunds(p_tenant uuid, p_document uuid, p_actor uuid)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  x record; res public.withdrawal_reports; out jsonb := '[]'::jsonb; locked uuid; today date := (now() at time zone 'Asia/Seoul')::date;
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
    -- 다른 release·cron이 잡고 있으면 조용히 건너뛴다(그쪽이 처리한다) — 잡은 뒤 조건을 다시 본다(그 사이 처리됐을 수 있다).
    locked := null;
    select g.id into locked from public.withdrawal_report_groups g where g.id = x.gid for update skip locked;
    continue when locked is null;
    continue when not exists(select 1 from public.withdrawal_report_groups g where g.id = x.gid
      and ((g.status = 'pending' and not exists(select 1 from public.withdrawal_reports q where q.group_id = g.id and q.status <> 'approved'))
           or (g.status = 'scheduled' and g.effective_date <= today))
      and not public.withdrawal_report_refund_pending(g.id));
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

-- 새로 만든 함수·트리거를 지운다. 결정 표·묶음 칸은 남긴다(데이터 보존 · 옛 함수는 읽지 않는다 · 다시 적용하면 그대로 쓴다).
drop function public.decide_withdrawal_report_refund(uuid, uuid, uuid, jsonb, jsonb);
drop function public.withdrawal_report_refund_note(uuid, uuid, jsonb, uuid, boolean);
drop trigger withdrawal_report_refund_complete_guard on public.academy_documents;
drop function public.withdrawal_report_refund_complete_guard();

-- 되돌린 뒤 = s2_0032 적용 전 지문(s2_0030 적용 뒤 · 2026-11-06 운영)이어야 한다.
do $$
declare
  want constant jsonb := jsonb_build_object(
    'public.transition_withdrawal_report(uuid,uuid,uuid,text,jsonb)', 'a105bba84b9630353d04729397e190d9',
    'public.transition_withdrawal_report_v1(uuid,uuid,uuid,text,jsonb)', '5a11f3fc0e920c413902ba2f137d0666',
    'public.attach_withdrawal_report_refund(uuid,uuid,uuid,uuid,uuid,boolean)', '846a34cb47bf901eb959c3e51f2b87e5',
    'public.release_withdrawal_report_refunds(uuid,uuid,uuid)', 'b03844a446c9db506fef5669c552c187',
    'staff_tasks_private.withdrawal_sync_report(uuid)', 'a8a0fb1aa5b897ff1eac199a33b03a5f');
  fn text;
  got text;
begin
  for fn in select jsonb_object_keys(want) loop
    select md5(regexp_replace(pg_get_functiondef(fn::regprocedure), '[[:space:]]+', '', 'g')) into got;
    if got is distinct from want->>fn then
      raise exception 'revert-s2_0032: 되돌린 뒤 % 의 정의가 s2_0032 적용 전 지문과 다릅니다(%). 거래를 취소합니다.', fn, got;
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;
