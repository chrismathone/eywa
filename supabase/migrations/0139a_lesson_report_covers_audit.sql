-- 0139a: 실제 수업일(covers_date) 지정의 **감사 기록** — 누가·언제·왜(원장 2026-07-22 "감사 기록 진행").
--
-- 배경: covers_date(0136a)는 그 (학생, 날짜)를 **작성률 분모에서 면제**한다 = 강사 평가 지표를 빼주는 값이다.
--   이월(carryover, 0134a)에는 `carryover_by/at/note` 감사가 있는데 이쪽만 없어, 누가 어떤 근거로
--   면제를 걸었는지 되짚을 수 없었다(적대 검증에서 지적된 갭).
-- 면제·예외를 주는 값은 **반드시 흔적을 남긴다** — 지표를 빼주는 권한은 추적 가능해야 한다.
--
-- covers_note는 자유 텍스트지만 화면은 원장이 정의한 두 경우를 프리셋으로 준다:
--   · 선발송   = 시험대비처럼 수업을 미리 하고 보고서를 먼저 씀
--   · 연속수업 = 뒤 수업분을 앞 수업에 몰아서 함(출석 2타임, 보고서 1건)
-- ⚠️ covers_date와 같이 **내부 메타데이터** — 학부모 발송 페이로드에 싣지 않는다.
-- 롤백 = drop column covers_by, covers_at, covers_note.

alter table public.lesson_reports
  add column if not exists covers_by uuid references public.users (id),
  add column if not exists covers_at timestamptz,
  add column if not exists covers_note text;

comment on column public.lesson_reports.covers_by is
  '실제 수업일(covers_date)을 지정한 사람 — 작성률 분모를 면제하는 값이라 추적을 남긴다(0139a).';
comment on column public.lesson_reports.covers_at is
  'covers_date 지정 시각(0139a).';
comment on column public.lesson_reports.covers_note is
  'covers_date 지정 사유 — 화면 프리셋은 "선발송"·"연속수업"(0139a). ⚠️ 내부 메타데이터.';
