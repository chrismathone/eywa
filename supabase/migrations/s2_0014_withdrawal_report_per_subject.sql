-- s2_0014 — 퇴원보고서: 과목이 다르면 같은 학생의 요청이 서로 막지 않는다 (2026-11-02)
--
-- 왜: 원장 *"과목 다르면 안 막히게 바꿔줘 상태값으로 해서 각각 해서 0하면 퇴원하면 되자나"* — 김소은(영어 수강종료 보고서가 원장 승인
--     대기)이 수학 퇴원보고서를 신청하지 못했다. 한 학생에 진행 중인 묶음을 하나만 허용하는 부분 유니크 인덱스와 두 함수의 검사 때문.
-- 무엇:
--   ① 학생당 진행 중 묶음 하나(`withdrawal_report_groups_pending` 유니크)를 일반 인덱스로 바꾼다. 대신 요청·바로 처리 함수가
--      **같은 과목**(또는 진행 중인 '퇴원' 묶음)이 있을 때만 거절한다. 두 함수는 검사 전에 학생 행을 잠그므로 동시 요청도 한 줄로 선다.
--   ② 최종 처리와 제출 트리거의 대조 — 과목 수강종료 묶음은 **학생 정보 + 자기 과목의 수강**만 대조한다(다른 과목 묶음이 먼저 끝나
--      영어 수강이 닫혀도 수학 묶음이 '정보가 변경되었습니다'로 멈추지 않게). 퇴원 묶음은 종전대로 학생 전체를 대조한다.
--   ③ 수강종료 묶음을 처리한 뒤 운영 중인 반의 수강이 하나도 남지 않으면 그 묶음을 **퇴원**으로 올려 학생을 퇴원시킨다
--      (먼저 끝난 과목이 있으면 마지막 과목 보고서가 퇴원을 마무리한다 · 휴원 수강은 남은 수강이다). 퇴원 경고 트리거(0454a)가
--      보는 '처리 구분 = 퇴원 · 처리일 = 퇴원일'과 같은 모양이라 경고가 나지 않는다.
--   나머지 본문은 운영 함수 그대로(pg_get_functiondef에서 그 줄만 치환 · s2_0009·s2_0013과 같은 방식 · 줄 하나씩 — 파일 줄바꿈이 CRLF라
--   여러 줄에 걸친 글자는 맞추지 않는다).
-- 🔴 앱보다 먼저든 나중이든 된다(#95) — 앱은 신청 창에서 진행 중인 과목의 반을 빼고 보여 줄 뿐이다(적용 전에는 DB가 종전처럼 거절).
-- 되돌리기 = scripts/_oneoff/revert-s2_0014-withdrawal-report-per-subject.sql(같은 학생에 진행 중인 묶음이 둘 이상이면 멈춘다).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

drop index if exists public.withdrawal_report_groups_pending;
create index if not exists withdrawal_report_groups_open on public.withdrawal_report_groups(tenant_id, student_id) where status not in ('completed','canceled');

-- 스냅숏을 학생 정보 + 고른 과목의 수강으로 좁힌다(대조용).
create or replace function public.withdrawal_report_scope(p_snapshot jsonb, p_subjects text[]) returns jsonb
language sql immutable security invoker set search_path = public as $$
 select (p_snapshot - 'courses') || jsonb_build_object('courses', coalesce((
   select jsonb_agg(e order by e->>'id') from jsonb_array_elements(coalesce(p_snapshot->'courses', '[]'::jsonb)) e
   where e->>'subject' = any(p_subjects)), '[]'::jsonb))
$$;
revoke all on function public.withdrawal_report_scope(jsonb, text[]) from public, anon, authenticated;
grant execute on function public.withdrawal_report_scope(jsonb, text[]) to service_role;

do $$
declare
  definition text;
  hits int;
  o text;
  overlap text := 'exists(select 1 from public.withdrawal_report_groups g2 where g2.tenant_id=p_tenant and g2.student_id=s.id and g2.status not in (''completed'',''canceled'') and (g2.exit_kind=''withdrawal'' or g2.subjects && chosen or cardinality(chosen)=0))';
  busy text := ' then raise exception ''같은 과목의 퇴원보고서가 진행 중입니다. 그 보고서를 먼저 마무리해 주세요.''; end if;';
begin
  -- ① 작성 요청 — 반을 고른 뒤(종강 반 검사 바로 다음) 같은 과목의 진행 중 묶음을 본다.
  select pg_get_functiondef('public.request_withdrawal_report_group(uuid,uuid,jsonb)'::regprocedure) into definition;
  if position('g2.subjects && chosen' in definition) = 0 then
    o := 'then raise exception ''종강되었거나 운영하지 않는 반은 선택할 수 없습니다. 반 목록을 새로고침해 주세요.''; end if;';
    hits := (length(definition) - length(replace(definition, o, ''))) / length(o);
    if hits <> 1 then raise exception 's2_0014: 요청 함수의 종강 반 검사 줄이 하나가 아닙니다(%건)', hits; end if;
    execute replace(definition, o, o || ' if ' || overlap || busy);
  end if;

  -- ① 바로 처리 — 학생 전체를 막던 묶음 검사를 빼고(옛 단건 보고서 검사는 그대로) 과목을 고른 뒤 같은 검사.
  select pg_get_functiondef('public.direct_withdrawal_report(uuid,uuid,jsonb)'::regprocedure) into definition;
  if position('g2.subjects && chosen' in definition) = 0 then
    o := 'if exists(select 1 from public.withdrawal_reports where tenant_id = p_tenant and student_id = s.id and status not in (''completed'',''canceled''))';
    hits := (length(definition) - length(replace(definition, o, ''))) / length(o);
    if hits <> 1 then raise exception 's2_0014: 바로 처리 함수의 보고서 검사 줄이 하나가 아닙니다(%건)', hits; end if;
    definition := replace(definition, o, 'if exists(select 1 from public.withdrawal_reports where tenant_id = p_tenant and student_id = s.id and group_id is null and status not in (''completed'',''canceled''))');
    o := 'or exists(select 1 from public.withdrawal_report_groups where tenant_id = p_tenant and student_id = s.id and status not in (''completed'',''canceled'')) then';
    hits := (length(definition) - length(replace(definition, o, ''))) / length(o);
    if hits <> 1 then raise exception 's2_0014: 바로 처리 함수의 묶음 검사 줄이 하나가 아닙니다(%건)', hits; end if;
    definition := replace(definition, o, 'then');
    o := 'into chosen from jsonb_array_elements(snap->''courses'') e where (e->>''id'')::uuid = any(targets);';
    hits := (length(definition) - length(replace(definition, o, ''))) / length(o);
    if hits <> 1 then raise exception 's2_0014: 바로 처리 함수의 과목 줄이 하나가 아닙니다(%건)', hits; end if;
    execute replace(definition, o, o || ' if ' || overlap || busy);
  end if;

  -- ②③ 처리 함수(묶음) — 수강종료 묶음은 자기 과목만 대조 · 남은 수강이 없으면 퇴원으로 마무리.
  select pg_get_functiondef('public.transition_withdrawal_report(uuid,uuid,uuid,text,jsonb)'::regprocedure) into definition;
  if position('withdrawal_report_scope(' in definition) = 0 then
    o := 'valid:=snap is not distinct from g.snapshot';
    hits := (length(definition) - length(replace(definition, o, ''))) / length(o);
    if hits <> 1 then raise exception 's2_0014: 처리 함수의 대조 줄이 하나가 아닙니다(%건)', hits; end if;
    definition := replace(definition, o, 'valid:=(case when g.exit_kind=''withdrawal'' then snap is not distinct from g.snapshot else public.withdrawal_report_scope(snap,g.subjects) is not distinct from public.withdrawal_report_scope(g.snapshot,g.subjects) end)');
    o := 'if g.exit_kind=''withdrawal'' then';
    hits := (length(definition) - length(replace(definition, o, ''))) / length(o);
    if hits <> 1 then raise exception 's2_0014: 처리 함수의 퇴원 분기 줄이 하나가 아닙니다(%건)', hits; end if;
    execute replace(definition, o,
      'if g.exit_kind<>''withdrawal'' and not exists(select 1 from public.enrollments e join public.classes c on c.id=e.class_id and c.tenant_id=p_tenant where e.tenant_id=p_tenant and e.student_id=g.student_id and not e.id=any(coalesce(targets,''{}''::uuid[])) and c.is_active and c.closed_at is null and (e.end_date is null or e.end_date>greatest(g.effective_date,today))) then'
      || ' g.exit_kind:=''withdrawal''; update public.withdrawal_report_groups set exit_kind=''withdrawal'' where id=g.id; update public.withdrawal_reports set exit_kind=''withdrawal'' where group_id=g.id; end if; '
      || o);
  end if;

  -- ② 제출 트리거 — 같은 규칙(수강종료 묶음은 학생 정보 + 묶음 과목의 수강만).
  select pg_get_functiondef('public.check_withdrawal_report_submission()'::regprocedure) into definition;
  if position('withdrawal_report_scope(' in definition) = 0 then
    o := 'if public.withdrawal_report_snapshot(new.tenant_id,new.student_id) is distinct from new.snapshot then';
    hits := (length(definition) - length(replace(definition, o, ''))) / length(o);
    if hits <> 1 then raise exception 's2_0014: 제출 트리거의 대조 줄이 하나가 아닙니다(%건)', hits; end if;
    execute replace(definition, o,
      'if (case when new.exit_kind=''withdrawal'' then public.withdrawal_report_snapshot(new.tenant_id,new.student_id) is distinct from new.snapshot'
      || ' else public.withdrawal_report_scope(public.withdrawal_report_snapshot(new.tenant_id,new.student_id),coalesce((select g.subjects from public.withdrawal_report_groups g where g.id=new.group_id and g.tenant_id=new.tenant_id),new.subjects))'
      || ' is distinct from public.withdrawal_report_scope(new.snapshot,coalesce((select g.subjects from public.withdrawal_report_groups g where g.id=new.group_id and g.tenant_id=new.tenant_id),new.subjects)) end) then');
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
