-- 0392b 드라이런 — 읽기 전용(SELECT 하나). 0392a 적용 뒤, 0392b 전에 돌린다.
-- 결과 한 줄 = (갈래, 지점, 출처·상태) 별로 0392b가 넣을 줄 수. 0392b를 돌린 뒤 다시 돌리면 전부 0이어야 한다(멱등).
with req_cut as (
  select coalesce(min(e.at), now()) as cut
  from public.lesson_report_send_events e where e.origin = 'trigger'
),
r1 as (
  select lr.tenant_id, coalesce(lr.source, '(없음)') || ' · ' || coalesce(lr.classnote_status, '(없음)') as k
  from public.lesson_reports lr
  where lr.classnote_sent_at is not null
    and not exists (
      select 1 from public.lesson_report_send_events e
      where e.report_id = lr.id and e.tenant_id = lr.tenant_id and e.sent_at = lr.classnote_sent_at
        and e.event in ('sent', 'failed'))
),
r2 as (
  select a.tenant_id, a.action || ' · ' || coalesce(a.metadata ->> 'status', '(없음)') as k
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
    and a.created_at < (select cut from req_cut)
    and not exists (
      select 1 from public.lesson_report_send_events e
      where e.origin = 'backfill_audit' and e.source_id = a.id and e.report_id = x.report_id)
),
r3 as (
  select distinct on (c.report_id, c.sent_at) c.tenant_id, c.event as k
  from public.lesson_report_send_events c
  where c.event in ('cleared', 'deleted') and c.sent_at is not null
    and not exists (
      select 1 from public.lesson_report_send_events e
      where e.report_id = c.report_id and e.tenant_id = c.tenant_id and e.sent_at = c.sent_at
        and e.event in ('sent', 'failed'))
  order by c.report_id, c.sent_at, c.id
)
select q.part, t.slug, q.k, q.n
from (
  select '① 보고서 행의 발송' as part, tenant_id, k, count(*)::int as n from r1 group by 1, 2, 3
  union all
  select '② 발송 요청 감사로그', tenant_id, k, count(*)::int from r2 group by 1, 2, 3
  union all
  select '③ 지움 기록의 옛 발송', tenant_id, k, count(*)::int from r3 group by 1, 2, 3
) q
join public.tenants t on t.id = q.tenant_id
order by 1, 2, 3;
