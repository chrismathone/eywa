-- s2_0030 — 퇴원보고서: 관리자 승인자에서 원장급(master · 운영자 계정)을 DB에서도 막는다 (2026-11-06)
-- 번호: 가지 이름 s2_0028 → main 병합 때 다음 빈 번호 s2_0030(main의 s2_0028·s2_0029 = 상담 약속·인계 · 2026-11-06).
--
-- 왜: 원장 2026-11-05 *"관리자 승인에 '원일' 넣지 말것. 항상 '정유진' 혹은 '허은진'. 지정된 사람으로. 원장이상급은 뺴기로 했는데 자꾸 들어가있네"*
--     → 2026-11-06 원장 결정 *"DB도 막기"*. 앱은 승인 후보에서 원장급을 빼고 서버가 다시 계산한다(다른 작업에서 고친다). 이 파일은 DB 마지막 방어선이다.
--     적대 리뷰 근거(s2_0025): 요청 함수가 승인 관리자 역할에 master를 받았다 — 서비스 키로 `reportManagerIds {작성자: [원장 id]}`를 보내면 그대로 저장됐다.
--     처리 함수도 master의 관리자 승인과 최종 처리 재검사를 통과시켰다. 작성 강사가 master이면 관리자 승인 생략(빈 승인자)도 받았다.
-- 기준: 운영 정의(2026-11-06 읽기 전용 덤프)의 본문이다. 요청·처리 함수 본문은 s2_0025 파일과 글자까지 같았다(뒤 마이그레이션이 바꾸지 않았다).
--       아래 지문(공백 뺀 md5)이 맞을 때만 바꾼다. 다르면 멈추니, 바뀐 내용을 이 파일에 옮긴 뒤 지문을 갱신한다.
-- 무엇: 관리자 승인자 = 관리자·매니저 `('admin','manager')`만. 운영자 계정은 기존 함수와 같은 방식 `not coalesce(public.is_super_admin(…),false)`으로 뺀다
--       (운영 계정 3개는 모두 system_role이 master라 원장급 제외로도 빠지지만 같은 글자로 한 번 더 막는다).
--   1) request_withdrawal_report_group — CREATE OR REPLACE(운영 본문에서 아래 줄만 바꿈)
--      ① 보고서마다 빈 목록(관리자 승인 생략)일 때 작성 강사 조건: in ('admin','manager','master') → in ('admin','manager') (운영자 제외는 원래 있음)
--      ② 승인 관리자 검사: in ('admin','manager','master') → in ('admin','manager') (운영자 제외는 원래 있음)
--      ③ 새 줄: 승인 관리자에 원장급(master · 운영자)이 있으면 '원장급은 관리자 승인자로 지정할 수 없습니다. …'로 따로 거절한다.
--         ②의 '현재 재직 중인 승인 관리자를 선택해 주세요.'만 보면 원장이 재직 중인데 왜 막히는지 알 수 없기 때문이다.
--      + ①의 설명 주석 한 줄 · ③ 앞 설명 주석 한 줄
--   2) transition_withdrawal_report — CREATE OR REPLACE(운영 본문에서 아래 줄만 바꿈)
--      ④ 승인·반려의 관리자 차례(manager_pending): actor in ('admin','manager','master') → actor in ('admin','manager') and 운영자 아님
--      ⑤ 최종 처리 재검사의 승인 관리자: 바로 처리(direct) 보고서는 종전 그대로(admin·manager·master), 그 밖의 보고서는 master·운영자가 아니어야 한다.
--      ⑥ 최종 처리 재검사의 생략 보고서 작성 강사: in ('admin','manager','master') → in ('admin','manager') and 운영자 아님(①과 같은 조건)
--      + ⑤ 앞 설명 주석 한 줄 · ⑥의 설명 주석 한 줄
--   3) transition_withdrawal_report_v1(옛 단건 — 처리 함수의 'request'와 묶음 없는 보고서가 지난다) — s2_0013·s2_0025처럼 운영 정의에서 그 줄만 치환
--      ⑦ 작성 요청의 관리자: in ('manager','admin','master') → in ('manager','admin') (운영자 제외는 원래 있음)
--      ⑧ 관리자 차례 승인·반려: actor in ('admin','manager','master') → actor in ('admin','manager') and 운영자 아님
--      ⑨ 처리(apply) 재검사의 관리자: in ('admin','manager','master') → in ('admin','manager') and 운영자 아님
--      본문 전체를 옮기지 않은 까닭: _v1에는 학생을 퇴원으로 쓰는 줄이 있다. 가드 `via-report-wiring.test.ts`는 처리 함수
--      (`transition_withdrawal_report`) 재정의만 예외로 둔다. 진행 중 옛 단건은 0건이다.
-- 그대로 두는 것: 원장 승인 단계(director_pending — 원장만 · 운영자 아님) · 바로 처리(`direct_withdrawal_report` — 원장·관리자·매니저 · 승인 칸 = 처리한 사람 ·
--   이 파일은 재정의하지 않는다) · 최종 처리(apply·release) 권한 · 취소(요청자·원장) · 작성 요청자(원장·관리자·매니저) · 작성 강사(강사·관리자·매니저·원장) ·
--   함수 시그니처 · 소유자 · 실행 권한(GRANT — CREATE OR REPLACE는 권한을 그대로 둔다) · SECURITY INVOKER · search_path.
-- 원장이 작성 강사인 보고서: 관리자 승인을 생략하지 않는다. 지정 승인자(관리자·매니저)가 승인한다.
--   까닭: 생략은 '작성 강사가 승인자 몫'이라는 뜻이다(⑥ 주석). 그래서 원장 작성 보고서를 생략하면 곧 원장 승인이 된다.
--   앱 규칙은 '작성 강사가 그 과목 지정 승인자 본인이면 생략'이고 원장급은 승인자 후보가 아니다. 그러니 원장 작성 보고서는 생략 대상이 될 수 없다.
--   지금 배포된 앱의 `reportApprovalPlan`도 이미 `writer.role !== "master"`로 원장 작성 보고서를 생략하지 않는다.
--   막히지 않는다: 침산에는 재직 관리자·매니저가 9명 있고(지정 승인자 정유진·허은진) 이들이 승인한다. 원장은 언제든 '바로 처리'로도 끝낼 수 있다(그대로).
-- 진행 중(2026-11-06 읽기 전용 조회): 묶음 pending 2건(requested 1 · manager_pending 1)이고 승인 관리자는 둘 다 정유진(admin)이다. 바로 처리 0 · 옛 단건 0.
--   승인 칸에 master·운영자가 든 진행 중 보고서 0 · 작성자가 master·운영자인 생략 보고서 0 · master가 관리자로 결정한 진행 중 기록 0 → 걸리는 건이 없다.
--   지난 기록에서 승인 칸에 master가 든 비-direct 보고서는 완료 2 · 취소 2다. 끝난 건이라 이 파일과 무관하다.
-- 순서: 앱보다 먼저든 나중이든 된다.
--   지금 배포된 앱은 직원의 '승인 과목'으로 승인 후보를 고른다. 원장급 5명은 과목이 비어 있고, 지정 승인자가 운영 중인 과목(english·math)을 모두 맡는다.
--   그래서 후보에 원장이 나오지 않고, 적용 뒤에도 지금 앱의 요청은 오류가 되지 않는다.
--   다만 원장에게 승인 과목을 주고 지정 승인자가 없는 과목이 생기면 옛 앱은 원장을 후보로 보낼 수 있다. 그때는 ③ 문구로 거절된다.
--   데모 지점들과 '수학의힘'은 재직 관리자·매니저가 0명이고 원장도 승인 과목이 비어 있다. 지금 앱에서도 이미 승인 후보가 0명이라
--   묶음 요청을 못 한다 — 새로 막히는 것은 없다(지금까지 묶음 0건 · 바로 처리는 그대로 된다).
-- 적용 확인(읽기만):
--   select p.proname, pg_get_functiondef(p.oid) like '%s2_0030%' as applied from pg_proc p
--    where p.oid in ('public.request_withdrawal_report_group(uuid,uuid,jsonb)'::regprocedure, 'public.transition_withdrawal_report(uuid,uuid,uuid,text,jsonb)'::regprocedure);  -- 기대: 둘 다 true
--   select pg_get_functiondef('public.transition_withdrawal_report_v1(uuid,uuid,uuid,text,jsonb)'::regprocedure)
--     like '%r.manager_id=p_actor and actor.system_role::text in (''admin'',''manager'') and not%';  -- 기대: true
--   적용 뒤 지문(공백 뺀 md5 · 로컬 PGlite 0.5.8(PG 18.3)에 운영 정의를 올려 이 파일을 적용한 값 — 적용 전 지문 셋은 운영(PG 17.6)과 같았다):
--     request_withdrawal_report_group 35afaa5ff6182c6d87d4b0b9f3a29e82 · transition_withdrawal_report a105bba84b9630353d04729397e190d9 ·
--     transition_withdrawal_report_v1 5a11f3fc0e920c413902ba2f137d0666
--     (번호를 s2_0030으로 바꾸며 본문 주석의 번호 글자가 바뀌어 요청·처리 둘은 다시 셌다 — pg_get_functiondef 머리 표기 + 본문 글자의 공백 뺀 md5.
--      같은 계산이 옛 번호(s2_0028)의 적용 전·후 지문 넷과 일치했다 · _v1은 바뀌는 글자가 없어 그대로다.)
-- 적용할 때:
--   · 기본 search_path 세션(운영 기본값 = 사용자 이름 스키마 · public · extensions)에서 적용한다. search_path가 빈 값이면
--     pg_get_functiondef가 이름을 달리 적어 지문이 달라지고 멈춘다(안전한 쪽 실패 — 아무것도 바뀌지 않는다).
--   · do 블록으로 감싸 적용할 때는 아래 begin; 다음 줄부터 commit; 앞까지만 감싼다(이 머리 주석과 거래 문 둘은 빼고).
--     바깥 달러 따옴표 표식은 감싸는 범위에 없는 새 이름으로 고른다 — 본문은 이미 빈 표식 · o · n · function 네 가지를 쓴다.
--     머리 주석까지 감싸면 주석 글자가 바깥 표식과 겹칠 때 따옴표가 일찍 닫혀 문법 오류로 멈춘다(안전한 실패지만 적용되지 않는다).
--     do 블록 안에서는 set local statement_timeout이 그 do 문장 자체에는 걸리지 않는다(문장이 이미 시작됐다). lock_timeout은 걸린다.
--   · 통째 실행이 중간에 실패하면 ROLLBACK 하거나 연결을 닫는다(실패한 거래가 열린 채 남지 않게).
-- 되돌리기 = scripts/_oneoff/revert-s2_0030-withdrawal-approver-no-master.sql(적용 뒤 지문일 때만 되돌리고, 되돌린 뒤 적용 전 운영 지문인지 확인한다).
-- 🔴 한 번만 적용한다(다시 돌리면 지문 검사로 멈춘다).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 운영 정의 지문(2026-11-06 · 공백 뺀 md5) — 하나라도 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
declare
  want constant jsonb := jsonb_build_object(
    'public.request_withdrawal_report_group(uuid,uuid,jsonb)', '0c5f86da40dc60c05b44f00605270149',
    'public.transition_withdrawal_report(uuid,uuid,uuid,text,jsonb)', '65ec57a83f8b141b85bc65a63411576f',
    'public.transition_withdrawal_report_v1(uuid,uuid,uuid,text,jsonb)', 'd575408bab9253f47d3c789bc6e4c61c');
  fn text;
  got text;
begin
  for fn in select jsonb_object_keys(want) loop
    select md5(regexp_replace(pg_get_functiondef(fn::regprocedure), '[[:space:]]+', '', 'g')) into got;
    if got is distinct from want->>fn then
      raise exception 's2_0030: % 의 운영 정의가 기준(2026-11-06)과 다릅니다(%). 바뀐 내용을 이 파일에 옮긴 뒤 지문을 갱신하세요.', fn, got;
    end if;
  end loop;
end $$;

-- ── 1) 작성 요청 — ①②③(운영 본문 그대로 · 그 줄만) ────────────────────────────────────────────────────────
create or replace function public.request_withdrawal_report_group(p_tenant uuid, p_actor uuid, p_payload jsonb)
 returns uuid
 language plpgsql
 set search_path to 'public'
as $function$
declare s public.students; actor public.users; snap jsonb; chosen text[]; teachers uuid[]; managers uuid[]; directors uuid[]:='{}';
 gid uuid; rid uuid; teacher uuid; recipient uuid; subjects_for_teacher text[]; d date; kind text; scope_row jsonb; targets uuid[]; teacher_targets uuid[];
 per_report boolean; report_managers uuid[]; list jsonb; rm jsonb;
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
 if coalesce(cardinality(chosen),0)=0 or coalesce(cardinality(teachers),0) not between 1 and 20 then raise exception '대상 과목·작성 강사·승인 관리자를 선택해 주세요.'; end if;
 -- 원장 승인 단계는 없다(원장 2026-11-03) — 옛 화면이 보낸 directorIds는 받지 않는다(directors = 늘 빈 값).
 per_report:=jsonb_typeof(p_payload->'reportManagerIds')='object';
 -- 작성 강사 id 키는 소문자로 한 번 맞춘다(uuid 글자 대소문자와 무관하게 — 같은 강사가 두 키로 오면 거절).
 if per_report then
  select coalesce(jsonb_object_agg(lower(k),val),'{}'::jsonb) into rm from jsonb_each(p_payload->'reportManagerIds') e(k,val);
  if (select count(*) from jsonb_object_keys(rm))<>(select count(*) from jsonb_object_keys(p_payload->'reportManagerIds')) then raise exception '보고서마다 승인 관리자를 정해 주세요.'; end if;
 end if;
 if per_report then
  -- 새 화면: 보고서(작성 강사)마다 승인 관리자. 빈 목록 = 관리자 승인 생략 — 그 작성 강사가 관리자·매니저(원장급·운영자 계정 아님)일 때만(s2_0030).
  -- 과목 관리자인지(그 보고서 과목을 모두 맡는지)는 앱이 같은 계산으로 가린다(요청 창 · 서버 액션 reportApprovalPlan).
  if exists(select 1 from jsonb_object_keys(rm) k where k !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or not k::uuid=any(teachers))
     or exists(select 1 from unnest(teachers) t where not rm ? t::text) then raise exception '보고서마다 승인 관리자를 정해 주세요.'; end if;
  foreach teacher in array teachers loop
   list:=rm->teacher::text;
   if jsonb_typeof(list) is distinct from 'array' or jsonb_array_length(list)>20 then raise exception '보고서마다 승인 관리자를 정해 주세요.'; end if;
   if exists(select 1 from jsonb_array_elements_text(list) v where v::uuid=teacher) then raise exception '작성자·관리자를 서로 다르게 지정해 주세요.'; end if;
   if jsonb_array_length(list)=0 and not exists(select 1 from public.users where id=teacher and tenant_id=p_tenant and status='active' and system_role::text in ('admin','manager') and not coalesce(public.is_super_admin(id),false)) then raise exception '승인할 관리자를 선택해 주세요.'; end if;
  end loop;
  select coalesce(array_agg(distinct v::uuid order by v::uuid),'{}') into managers from jsonb_each(rm) e(k,val), jsonb_array_elements_text(e.val) x(v);
  if cardinality(managers)>20 then raise exception '승인 관리자는 20명까지 정할 수 있습니다.'; end if;
 else
  -- 옛 화면: 묶음 관리자 전원이 모든 보고서를 승인(1명 이상 · 작성자와 겹치지 않음).
  select coalesce(array_agg(distinct v::uuid order by v::uuid),'{}') into managers from jsonb_array_elements_text(coalesce(p_payload->'managerIds','[]'::jsonb)) x(v);
  if cardinality(managers) not between 1 and 20 then raise exception '대상 과목·작성 강사·승인 관리자를 선택해 주세요.'; end if;
  if teachers && managers then raise exception '작성자·관리자를 서로 다르게 지정해 주세요.'; end if;
 end if;
 if exists(select 1 from unnest(chosen) x where not exists(select 1 from jsonb_array_elements(snap->'courses') e where e->>'subject'=x)) then raise exception '선택 과목의 수강을 찾을 수 없습니다.'; end if;
 if actor.system_role::text<>'master' and not coalesce(public.is_super_admin(actor.id),false) then
  select x into scope_row from public.tenant_settings ts,lateral jsonb_array_elements(coalesce(ts.data#>'{permissions,specialAccess,staffSubjectScopes}','[]')) x where ts.tenant_id=p_tenant and x->>'userId'=actor.id::text limit 1;
  if scope_row is not null and exists(select 1 from unnest(chosen) x where not coalesce(scope_row->'subjects','[]') ? x) then raise exception '담당 과목의 보고서만 요청할 수 있습니다.'; end if;
 end if;
 if exists(select 1 from unnest(teachers) x where not exists(select 1 from public.users where id=x and tenant_id=p_tenant and status='active' and system_role::text in ('teacher','admin','manager','master')) or not exists(select 1 from jsonb_array_elements(snap->'courses') e where e->>'teacherId'=x::text and (e->>'id')::uuid=any(targets))) then raise exception '선택한 수강의 담당 강사를 지정해 주세요.'; end if;
 -- 종료 대상은 선택한 모든 반, 작성자는 그중 지정한 강사만이다.
 -- 승인 관리자 = 관리자·매니저만 — 원장급(master · 운영자 계정 포함)은 관리자 승인자가 아니다(원장 2026-11-05 · s2_0030). 알아보게 따로 거절한다.
 if exists(select 1 from unnest(managers) x join public.users u on u.id=x where u.tenant_id=p_tenant and (u.system_role::text='master' or coalesce(public.is_super_admin(u.id),false))) then raise exception '원장급은 관리자 승인자로 지정할 수 없습니다. 학원 설정의 퇴원보고서 승인자를 골라 주세요.'; end if;
 if exists(select 1 from unnest(managers) x where not exists(select 1 from public.users where id=x and tenant_id=p_tenant and status='active' and system_role::text in ('admin','manager') and not coalesce(public.is_super_admin(id),false))) then raise exception '현재 재직 중인 승인 관리자를 선택해 주세요.'; end if;
 d:=(p_payload->>'effectiveDate')::date;
 if d is null or d<coalesce(s.enrolled_at,d) or d>(now() at time zone 'Asia/Seoul')::date+365 then raise exception '마지막 수업일은 등록일 이후, 오늘부터 1년 이내로 지정해 주세요.'; end if;
 kind:=case when exists(select 1 from jsonb_array_elements(snap->'courses') e where not (e->>'id')::uuid=any(targets) and exists(select 1 from public.classes c where c.id=(e->>'classId')::uuid and c.tenant_id=p_tenant and c.is_active and c.closed_at is null)) then 'subject_end' else 'withdrawal' end;
 insert into public.withdrawal_report_groups(tenant_id,student_id,requested_by,teacher_ids,manager_ids,director_ids,subjects,effective_date,exit_kind,snapshot,enrollment_ids)
 values(p_tenant,s.id,p_actor,teachers,managers,directors,chosen,d,kind,snap,targets) returning id into gid;
 foreach teacher in array teachers loop
  select array_agg(distinct e->>'subject'),array_agg((e->>'id')::uuid order by e->>'id') into subjects_for_teacher,teacher_targets from jsonb_array_elements(snap->'courses') e where (cardinality(teachers)=1 or e->>'teacherId'=teacher::text) and (e->>'id')::uuid=any(targets);
  -- 보고서의 승인 관리자 — 새 화면은 그 작성 강사 몫(빈 목록 = 관리자 승인 생략 · manager_id = null), 옛 화면은 묶음 관리자 전원.
  if per_report then select coalesce(array_agg(distinct v::uuid order by v::uuid),'{}') into report_managers from jsonb_array_elements_text(rm->teacher::text) x(v);
  else report_managers:=managers; end if;
  insert into public.withdrawal_reports(tenant_id,student_id,requested_by,teacher_id,manager_id,director_id,manager_ids,director_ids,group_id,group_leader,subjects,effective_date,exit_kind,request_note,snapshot,enrollment_ids)
   values(p_tenant,s.id,p_actor,teacher,report_managers[1],null,report_managers,directors,gid,teacher=teachers[1],subjects_for_teacher,d,kind,coalesce(p_payload->>'note',''),snap,teacher_targets) returning id into rid;
  insert into public.withdrawal_report_events(tenant_id,report_id,actor_id,action,to_status) values(p_tenant,rid,p_actor,'request','requested');
  if teacher<>p_actor then insert into public.notifications(tenant_id,recipient_id,type,title,body,link,actor_id) values(p_tenant,teacher,'approval_requested','퇴원보고서 작성 요청',s.name||' · '||d::text,'/withdrawal-reports/'||rid::text,p_actor); end if;
 end loop;
 return gid;
end $function$;

-- ── 2) 처리 함수 — ④⑤⑥(운영 본문 그대로 · 그 줄만) ────────────────────────────────────────────────────────
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

-- ── 3) 옛 단건 처리 함수(_v1) — ⑦⑧⑨ 운영 정의에서 그 줄만 치환(줄마다 정확히 한 번) ─────────────────────────────────
do $$
declare
  definition text;
  pairs constant text[] := array[
    -- ⑦ 작성 요청의 관리자
    $o$system_role::text in ('manager','admin','master') and not coalesce(public.is_super_admin(id),false)) then raise exception '승인할 관리자를 지정해 주세요.'$o$,
    $n$system_role::text in ('manager','admin') and not coalesce(public.is_super_admin(id),false)) then raise exception '승인할 관리자를 지정해 주세요.'$n$,
    -- ⑧ 관리자 차례 승인·반려
    $o$(r.status='manager_pending' and r.manager_id=p_actor and actor.system_role::text in ('admin','manager','master')) or$o$,
    $n$(r.status='manager_pending' and r.manager_id=p_actor and actor.system_role::text in ('admin','manager') and not coalesce(public.is_super_admin(actor.id),false)) or$n$,
    -- ⑨ 처리(apply) 재검사의 관리자
    $o$not exists(select 1 from public.users where id=r.manager_id and tenant_id=p_tenant and status='active' and system_role::text in ('admin','manager','master')) or$o$,
    $n$not exists(select 1 from public.users where id=r.manager_id and tenant_id=p_tenant and status='active' and system_role::text in ('admin','manager') and not coalesce(public.is_super_admin(id),false)) or$n$];
  hits int;
begin
  select pg_get_functiondef('public.transition_withdrawal_report_v1(uuid,uuid,uuid,text,jsonb)'::regprocedure) into definition;
  for i in 1 .. array_length(pairs, 1) / 2 loop
    hits := (length(definition) - length(replace(definition, pairs[2*i-1], ''))) / length(pairs[2*i-1]);
    if hits <> 1 then raise exception 's2_0030: _v1의 바꿀 줄 %번이 하나가 아닙니다(%건)', i, hits; end if;
    definition := replace(definition, pairs[2*i-1], pairs[2*i]);
  end loop;
  execute definition;
end $$;

commit;
