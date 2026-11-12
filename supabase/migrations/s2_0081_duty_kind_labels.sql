-- s2_0081 — 업무 완성도: 할 일 제목의 종류 이름을 화면과 같게 (2026-11-10)
--
-- 왜: 원장 2026-11-10 *"월 상담 -> 학생 상담"* · *"신규생 정착 -> 신규생 관리"* → *"할 일 제목도 새 이름으로 맞춰줘"*. 화면 이름(앱 `kinds.ts`)은 바꿨는데
--   벨의 할 일 제목(`duty_escalate` · `duty_escalate_up`이 쓰는 `duties_private.kind_label`)은 옛 이름('월 학부모 상담' · '신규생 정착 콜')이었다.
-- 무엇: `kind_label`만 새 이름으로(인자 · 반환형 그대로). 모르는 종류는 영문 키 대신 '업무'(화면에 원시 키를 내보내지 않는다).
--   늦음 할 일 스위치가 꺼져 있어 지금 열린 할 일은 없다 — 켜면 새 이름으로 열린다. 앱과 같은 글자인지는 가드(`live-sync-wiring.test.ts`)가 본다.
-- 되돌리기: s2_0069의 kind_label 본문으로.
begin;

create or replace function duties_private.kind_label(p_kind text) returns text
language sql immutable
as $fn$
  select case p_kind
    when 'attendance'      then '출결 입력'
    when 'report_write'    then '수업보고서 작성'
    when 'report_send'     then '보고서 발송'
    when 'video_check'     then '영상 숙제 확인'
    when 'counsel_monthly' then '학생 상담'
    when 'exam_monthly'    then '월말평가'
    when 'newcomer_call'   then '신규생 관리'
    else '업무' end;
$fn$;

commit;
