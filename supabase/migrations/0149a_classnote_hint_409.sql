-- 0149a: 발송 실패 힌트에 **HTTP 409(중복 거부)** 분기 추가.
--
-- 2026-07-27 실사례: 학부모 공지 12건 중 **11건이 `게시 실패(HTTP 409)`**(김경민만 성공).
-- `classnote_failure_hint`의 `else err`에 걸려 알림·토스트에 워커 원문이 그대로 나갔다 —
-- 원장이 읽어도 "무엇을 해야 하는지"가 없다.
--
-- 🔴 409의 조치는 **"재발송"이 아니라 "이미 올라갔는지 먼저 확인"**이다. ClassNote는 학부모 쪽
--    게시글 수정·삭제가 없어서, 이미 올라간 글에 재발송하면 같은 글이 2개 남고 되돌릴 수 없다.
--    (이번 건은 원장이 ClassNote를 직접 열어 **미게시**를 확인 → 재발송 안전. 하지만 워커 응답만으로는
--     그걸 알 수 없었다는 게 문제였고, 워커 쪽은 "실패 시 실제 게시 여부 조회"로 따로 수리했다.)
--
-- ⚠️ 문구는 앱 `humanizeClassnoteError`(src/features/report-admin/classnote-error.ts)와 **같은 뜻**을
--    유지할 것 — 0144a 주석의 규약(세 표면이 같은 실패를 다르게 설명하지 않는다).
-- ⚠️ 409 분기는 `else err`보다 앞, 그리고 기존 분기들보다 **뒤**에 둔다(기존 사유가 더 구체적).
--
-- 롤백: 0144a의 함수 정의를 그대로 다시 실행하면 된다(이 파일은 함수 교체만, 데이터 변경 없음).

create or replace function public.classnote_failure_hint(err text)
returns text
language sql
immutable
as $$
  select case
    when coalesce(err, '') = '' then '사유가 기록되지 않았습니다 — 발송 콘솔에서 확인하세요.'
    when err ilike '%학생 없음%' or err ilike '%미가입%'
      then '학부모가 ClassNote 알림장에 연결되어 있지 않습니다 — 학부모를 초대한 뒤 다시 발송하세요.'
    when err ilike '%보드 미배정%' or err ilike '%배정 필요%'
      then '학생이 ClassNote 알림장에 배정되지 않았습니다 — 배정한 뒤 다시 발송하세요.'
    when err ilike '%보드 없음%' or err ilike '%프로비저닝%'
      then 'ClassNote 알림장이 아직 없습니다 — 알림장 생성 후 다시 발송하세요.'
    when err ilike '%409%'
      then 'ClassNote가 중복으로 보고 거부했습니다(409) — 알림장에 이미 올라갔는지 확인한 뒤 재발송하세요.'
    else err
  end;
$$;

comment on function public.classnote_failure_hint(text) is
  'ClassNote 발송 실패 원문 → 사람이 할 행동(한글). 보고서(0143a)·공지(0144a) 알림 트리거 공용. 앱 미러 = humanizeClassnoteError. 409 분기는 0149a.';
