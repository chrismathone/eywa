-- s2_0016 — 비포클래스체크리스트 '체크 제외'(사유) — 원장 2026-11-02
--
-- 원장 *"저번수업에 결석이였던 친구는 이번수업에서 비포클래스 체크를 할 수 없자나 그럴경우 사유를 받고 카드는 없음으로"* →
-- *"지난 수업 결석이면 자동으로 제외하고 바로 사유 받을수있는 란 · 수동으로도 · 사유 3가지(기타는 글로) · 보고서엔 아무 줄도 넣지마"*.
--
-- before_class_checks 에 칸 셋:
--   excused      = 체크 제외. null = 자동(지난 수업 결석이면 제외 — 앱이 저장 없이 판정) · true/false = 선생님이 직접 정한 값(자동보다 이긴다).
--   excuse_reason = 사유 종류(prev_absent 지난 수업 결석 · first_lesson 첫 수업 · other 기타). 판정·라벨은 앱(items.ts EXCUSE_REASONS).
--   excuse_note  = '기타' 사유 글.
-- 제외인 날은 완료율·보충 필요·미흡 항목·카드 통계에서 빠지고 카드는 '카드 X', 수업보고서엔 체크리스트 줄이 없다(앱 판정).
--
-- ⚠️ 앱은 이 칸이 **없어도 죽지 않는다**([[#95]]) — 읽기는 옛 칸으로 다시 읽고, 제외를 저장하려 할 때만 안내한다. 적용 순서 제약 없음.
-- 정책은 그대로 0개(서버 전용 표, s2_0003 참고).
--
-- 롤백: alter table public.before_class_checks drop column if exists excuse_note, drop column if exists excuse_reason, drop column if exists excused;
set local statement_timeout = '60s';

alter table public.before_class_checks
  add column if not exists excused boolean,
  add column if not exists excuse_reason text,
  add column if not exists excuse_note text;

alter table public.before_class_checks drop constraint if exists before_class_checks_excuse_reason;
alter table public.before_class_checks add constraint before_class_checks_excuse_reason
  check (excuse_reason is null or excuse_reason in ('prev_absent', 'first_lesson', 'other'));

alter table public.before_class_checks drop constraint if exists before_class_checks_excuse_note_len;
alter table public.before_class_checks add constraint before_class_checks_excuse_note_len
  check (excuse_note is null or char_length(excuse_note) <= 1000);

comment on column public.before_class_checks.excused is
  '체크 제외 — null = 자동(지난 수업 결석이면 제외, 앱 판정) · true/false = 선생님이 정한 값. s2_0016';
comment on column public.before_class_checks.excuse_reason is
  '제외 사유 — prev_absent · first_lesson · other. s2_0016';
comment on column public.before_class_checks.excuse_note is
  '제외 사유 글(기타). s2_0016';

notify pgrst, 'reload schema';
