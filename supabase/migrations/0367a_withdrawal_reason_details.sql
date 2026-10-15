-- 0367a — 퇴원·수강 종료 사유 2단계(원장 2026-10-15 *"퇴원사유를 50가지 정도로 세분화"*).
--
-- ① 수강 종료 행에 세부 사유·메모 칸 — 퇴원(학생 단위)은 `students.withdrawal_metadata.detail`(jsonb)에 담고,
--    과목만 끊는 부분 종료는 그 수강 행에 담는다. 키 목록은 앱(`src/features/withdrawals/reason-detail.ts`)이 단일 소스다
--    (저장 전에 앱이 그 대분류의 세부인지 본다 — `checkReasonInput`). 비어 있으면 '세부 미기재'.
-- ② 퇴원보고서 전이 함수(실험실) 두 개의 사유 목록에 새 대분류 다섯(grades·motivation·method·career·peers)을 더한다.
--    본문은 그대로 두고 목록 글자만 바꾼다(20261013210000과 같은 방식) — 바꿀 목록이 없으면 중단한다(조용히 넘어가지 않게).
--
-- 🔴 앱보다 먼저 적용한다(#95) — 부분 종료 저장·수강 종료 되돌리기가 새 칸을 쓴다.
-- 칸 추가는 기본값 없는 nullable이라 행을 다시 쓰지 않는다(잠금은 잠깐) · lock_timeout으로 오래 기다리지 않는다.
begin;
set local lock_timeout = '5s';

alter table public.enrollments
  add column if not exists withdrawal_detail text,
  add column if not exists withdrawal_memo text;

comment on column public.enrollments.withdrawal_detail is '수강 종료 세부 사유 키(퇴원관리 사유 2단계 · 목록은 앱 reason-detail.ts)';
comment on column public.enrollments.withdrawal_memo is '수강 종료 메모(실제 사유 글 · 기타는 필수)';

do $$
declare
  fn text;
  definition text;
  changed text;
  old_list constant text := '''graduated'',''relocation'',''illness'',''competitor'',''financial'',''schedule'',''dissatisfaction'',''advised'',''other''';
  new_list constant text := '''graduated'',''relocation'',''illness'',''competitor'',''financial'',''schedule'',''dissatisfaction'',''grades'',''motivation'',''method'',''career'',''peers'',''advised'',''other''';
begin
  foreach fn in array array[
    'public.transition_withdrawal_report(uuid,uuid,uuid,text,jsonb)',
    'public.transition_withdrawal_report_v1(uuid,uuid,uuid,text,jsonb)'
  ] loop
    select pg_get_functiondef(fn::regprocedure) into definition;
    if position(new_list in definition) > 0 then
      continue; -- 이미 적용됨(다시 돌려도 같다)
    end if;
    if position(old_list in definition) = 0 then
      raise exception '0367a: % 에서 바꿀 사유 목록을 찾지 못했습니다', fn;
    end if;
    changed := replace(definition, old_list, new_list);
    execute changed;
  end loop;
end $$;

-- API가 새 칸을 바로 보게(스키마 캐시 갱신).
notify pgrst, 'reload schema';

commit;
