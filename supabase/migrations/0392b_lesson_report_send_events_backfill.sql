-- 0392b — 수업보고서 발송 이력 백필(0392a 다음). 이력 표가 생기기 전의 발송을 한 번 옮긴다.
--
-- 🔴 먼저 드라이런(읽기 전용 SELECT): scripts/_oneoff/lesson-report-send-events-backfill-dry-run.sql — 0392a 적용 뒤,
--    이 파일 전에. 그 숫자만큼 들어간다(그 사이 트리거가 남긴 발송은 아래 not exists가 건너뛰어 조금 적을 수 있다).
--
-- 무엇을(세 갈래 — 전부 다시 돌려도 같다(멱등) · 그래서 빠진 기록을 메우는 용도로 언제 다시 돌려도 된다):
--   ① 보고서 행에 남은 발송(classnote_sent_at이 있는 행) → event 'sent' · origin 'backfill_report'.
--      to_status = 지금 상태(success · recalled 등) · sent_at = 행에 남은 마지막 발송 시각 하나(그 전의 재발송은 알 수 없다).
--      사본 = 백필한 날의 내용 — 발송 당시와 다를 수 있다(note에 적는다). 카드 표시 설정은 지금 값이라 싣지 않는다.
--      requested_by = 그 발송 시각 이전의 가장 최근 발송 요청 감사로그의 사람(②와 같은 펼침 · 2026-09-10부터만 있다).
--      그 발송 시각의 발송 줄(sent · 발송 시각이 찍힌 failed)이 이미 있으면 건너뛴다. 지금 상태가 failed인 행도 'sent'로 —
--      그 시각에 글이 나간 것은 같다(교차 확인 이상으로 찍힌 시각이든, 예전 발송 시각이 남은 채 다시 보냈다 실패한 것이든).
--   ② 발송 요청 감사로그(classnote_send · classnote_resend) → event 'requested'(too_old면 'held') · origin 'backfill_audit'.
--      이력 표가 생기기 전의 감사로그만(트리거가 남긴 첫 줄보다 앞) — 그 뒤의 요청은 트리거가 이미 남겼다.
--      감사로그 한 줄 × 보고서 하나 = 한 줄(source_id = audit_logs.id). 지워진 보고서는 감사로그의 값으로 채운다.
--   ③ 트리거가 '지움(cleared)·삭제(deleted)'로만 남긴 옛 발송 — 이력 표가 생긴 뒤 백필 전에 표시가 지워진 발송.
--      그 줄의 발송 시각·사본으로 'sent' 한 줄(origin 'backfill_report'). 발송 줄을 세면 발송 횟수가 되게.
-- 잠금: 새 표에 넣기만 한다(lesson_reports·audit_logs는 읽기만).
begin;
set local lock_timeout = '5s';

-- ① 보고서 행에 남은 발송 ------------------------------------------------------
with req as (
  -- 발송 요청 감사로그(②와 같은 펼침 — 선생님 발송 reportId · 관리자 일괄 reportIds · 재발송 classnote_resend).
  select a.tenant_id, x.report_id, a.actor_id, a.created_at
  from public.audit_logs a
  cross join lateral (
    select (a.metadata ->> 'reportId')::uuid as report_id
    where a.metadata ->> 'reportId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    union
    select r.v::uuid
    from jsonb_array_elements_text(case when jsonb_typeof(a.metadata -> 'reportIds') = 'array'
                                        then a.metadata -> 'reportIds' else '[]'::jsonb end) r(v)
    where r.v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) x
  where a.action in ('classnote_send', 'classnote_resend')
),
picked as (
  select distinct on (lr.id) lr.id, r.actor_id
  from public.lesson_reports lr
  join req r on r.report_id = lr.id and r.tenant_id = lr.tenant_id and r.created_at <= lr.classnote_sent_at
  where lr.classnote_sent_at is not null
  order by lr.id, r.created_at desc
)
insert into public.lesson_report_send_events (
  tenant_id, report_id, student_id, report_date, subject, class_id, makeup_class_id, classnote_class_id,
  event, origin, to_status, sent_at, queued_at, processing_at, retry_count, error, share_token,
  requested_by, snapshot, snapshot_at, note)
select
  lr.tenant_id, lr.id, lr.student_id, lr.report_date, lr.subject, lr.class_id, lr.makeup_class_id,
  lr.classnote_class_id,
  'sent', 'backfill_report', lr.classnote_status, lr.classnote_sent_at, lr.classnote_queued_at,
  lr.classnote_processing_at, lr.classnote_retry_count, lr.classnote_error, lr.share_token,
  p.actor_id,
  lesson_report_send_private.snapshot(to_jsonb(lr), lr.tenant_id, false), now(),
  '이력 표가 생기기 전의 발송 — 보고서 행에 남은 마지막 발송 시각 하나. 사본은 백필한 날의 내용(발송 당시와 다를 수 있다)'
from public.lesson_reports lr
left join picked p on p.id = lr.id
where lr.classnote_sent_at is not null
  and not exists (
    select 1 from public.lesson_report_send_events e
    where e.report_id = lr.id and e.tenant_id = lr.tenant_id and e.sent_at = lr.classnote_sent_at
      and e.event in ('sent', 'failed'));

-- ② 발송 요청 감사로그 ----------------------------------------------------------
insert into public.lesson_report_send_events (
  tenant_id, report_id, student_id, report_date, subject, class_id, classnote_class_id,
  event, origin, to_status, at, actor_id, actor_name, source_id, note)
select
  a.tenant_id, x.report_id,
  coalesce(lr.student_id, case when a.metadata ->> 'studentId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                               then (a.metadata ->> 'studentId')::uuid end),
  coalesce(lr.report_date, case when a.metadata ->> 'date' ~ '^\d{4}-\d{2}-\d{2}$'
                                then (a.metadata ->> 'date')::date end),
  coalesce(lr.subject, a.metadata ->> 'subject'),
  coalesce(lr.class_id, case when a.metadata ->> 'classId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                             then (a.metadata ->> 'classId')::uuid end),
  case when a.metadata ->> 'sendClassId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (a.metadata ->> 'sendClassId')::uuid end,
  case when a.metadata ->> 'status' = 'too_old' then 'held' else 'requested' end,
  'backfill_audit', a.metadata ->> 'status', a.created_at, a.actor_id, a.actor_name, a.id,
  left('감사로그에서 옮김(' || a.action || coalesce(' · ' || (a.metadata ->> 'via'), '') || ')', 200)
from public.audit_logs a
cross join lateral (
  select (a.metadata ->> 'reportId')::uuid as report_id
  where a.metadata ->> 'reportId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  union
  select r.v::uuid
  from jsonb_array_elements_text(case when jsonb_typeof(a.metadata -> 'reportIds') = 'array'
                                      then a.metadata -> 'reportIds' else '[]'::jsonb end) r(v)
  where r.v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
) x
left join public.lesson_reports lr on lr.id = x.report_id and lr.tenant_id = a.tenant_id
where a.action in ('classnote_send', 'classnote_resend')
  and a.created_at < (
    select coalesce(min(e.at), now()) from public.lesson_report_send_events e where e.origin = 'trigger')
  and not exists (
    select 1 from public.lesson_report_send_events e
    where e.origin = 'backfill_audit' and e.source_id = a.id and e.report_id = x.report_id);

-- ③ 지움·삭제로만 남은 옛 발송 ---------------------------------------------------
insert into public.lesson_report_send_events (
  tenant_id, report_id, student_id, report_date, subject, class_id, makeup_class_id, classnote_class_id,
  event, origin, from_status, to_status, sent_at, queued_at, processing_at, retry_count, error, share_token,
  snapshot, snapshot_at, note)
select distinct on (c.report_id, c.sent_at)
  c.tenant_id, c.report_id, c.student_id, c.report_date, c.subject, c.class_id, c.makeup_class_id,
  c.classnote_class_id,
  'sent', 'backfill_report', null, c.from_status, c.sent_at, c.queued_at, c.processing_at, c.retry_count,
  c.error, c.share_token, c.snapshot, c.snapshot_at,
  '이력 표가 생기기 전의 발송 — 표시를 지운 기록(' || c.event || ')에서 되살림. 사본은 지우기 직전의 내용'
from public.lesson_report_send_events c
where c.event in ('cleared', 'deleted')
  and c.sent_at is not null
  and not exists (
    select 1 from public.lesson_report_send_events e
    where e.report_id = c.report_id and e.tenant_id = c.tenant_id and e.sent_at = c.sent_at
      and e.event in ('sent', 'failed'))
order by c.report_id, c.sent_at, c.id;

commit;
