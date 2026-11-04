-- s2_0013 — 퇴원보고서: superadmin 승인자 차단 · 원장 바로 승인 알림 제목 · 수학(심화) 지난 기록 정리 (2026-10-30)
--
-- 왜: 원장 *"superadmin은 조심 … 진짜 원장이 원장에 있어야함"* · 리뷰(요청 창만 막고 서버·DB는 안 막음) → 원장 승인.
--     담임이 관리자라 관리자 칸을 건너뛴 보고서(승인자 칸 = 원장)도 알림이 '관리자 승인 요청'으로 갔다.
--     원장 *"수학(심화)는 없애 … 전부 수학이야"* — 학원 설정·반에는 이미 없고 청구 회차 12행에만 키가 남았다.
-- 무엇:
--   ① 작성 요청의 승인 관리자에 super_admin을 거부한다(`request_withdrawal_report_group` · 한 건 `_v1`의 관리자·원장).
--      처리(apply) 재검사에는 넣지 않았다 — 운영 계정이 '바로 처리'한 보고서는 승인 칸이 본인이라 막으면 처리가 멈춘다.
--      현재 승인 칸에 super_admin이 든 보고서는 0건(2026-10-30 실측)이라 진행 중 건에 영향이 없다.
--   ② 제출 알림 — 원장 칸이 비고 승인자가 전부 원장이면 '퇴원보고서 원장 승인 요청'(앱 `skipsManagerStep`과 같은 판정).
--   ③ `invoice_session_terms.subject` subject_1 → math(미확정 12행).
--   나머지 본문은 운영 함수 그대로(pg_get_functiondef에서 그 줄만 치환 · s2_0009와 같은 방식).
-- 되돌리기 = scripts/_oneoff/revert-s2_0013-withdrawal-superadmin-block.sql

do $$
declare
  definition text;
  hits int;
  guard text := ' and not coalesce(public.is_super_admin(id),false)';
  o text;
begin
  select pg_get_functiondef('public.request_withdrawal_report_group(uuid,uuid,jsonb)'::regprocedure) into definition;
  o := 'system_role::text in (''admin'',''manager'',''master''))) then raise exception ''현재 재직 중인 승인 관리자를 선택해 주세요.''';
  hits := (length(definition) - length(replace(definition, o, ''))) / length(o);
  if hits <> 1 then raise exception 's2_0013: 요청 함수의 관리자 검사 줄이 하나가 아닙니다(%건)', hits; end if;
  execute replace(definition, o, 'system_role::text in (''admin'',''manager'',''master'')' || guard || ')) then raise exception ''현재 재직 중인 승인 관리자를 선택해 주세요.''');

  select pg_get_functiondef('public.transition_withdrawal_report(uuid,uuid,uuid,text,jsonb)'::regprocedure) into definition;
  o := 'recipients:=g.manager_ids; headline:=''퇴원보고서 관리자 승인 요청'';';
  hits := (length(definition) - length(replace(definition, o, ''))) / length(o);
  if hits <> 1 then raise exception 's2_0013: 묶음 전이 함수의 제출 알림 줄이 하나가 아닙니다(%건)', hits; end if;
  execute replace(definition, o,
    'recipients:=g.manager_ids; headline:=case when cardinality(g.director_ids)=0 and not exists(select 1 from unnest(g.manager_ids) x where not exists(select 1 from public.users u where u.id=x and u.tenant_id=p_tenant and u.system_role::text=''master'')) then ''퇴원보고서 원장 승인 요청'' else ''퇴원보고서 관리자 승인 요청'' end;');

  select pg_get_functiondef('public.transition_withdrawal_report_v1(uuid,uuid,uuid,text,jsonb)'::regprocedure) into definition;
  o := 'system_role::text in (''manager'',''admin'',''master'')) then raise exception ''승인할 관리자를 지정해 주세요.''';
  hits := (length(definition) - length(replace(definition, o, ''))) / length(o);
  if hits <> 1 then raise exception 's2_0013: _v1의 관리자 검사 줄이 하나가 아닙니다(%건)', hits; end if;
  definition := replace(definition, o, 'system_role::text in (''manager'',''admin'',''master'')' || guard || ') then raise exception ''승인할 관리자를 지정해 주세요.''');
  o := 'system_role::text=''master'') then raise exception ''승인할 원장을 지정해 주세요.''';
  hits := (length(definition) - length(replace(definition, o, ''))) / length(o);
  if hits <> 1 then raise exception 's2_0013: _v1의 원장 검사 줄이 하나가 아닙니다(%건)', hits; end if;
  execute replace(definition, o, 'system_role::text=''master''' || guard || ') then raise exception ''승인할 원장을 지정해 주세요.''');
end $$;

update public.invoice_session_terms set subject = 'math' where subject = 'subject_1';
