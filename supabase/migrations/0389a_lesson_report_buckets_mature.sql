-- 0389a — 보고서 통계 '48시간 안 확인율'의 분모·분자를 **보낸 지 48시간이 지난 보고서**로(리뷰 2026-10-21 · 원장 *"전체적으로 상세 추이페이지
-- 검토해"*). 0388a는 분모(sent)에 방금 보낸 보고서까지 넣어, 아직 확인할 시간이 남은 최근 이틀의 확인율이 늘 뚝 떨어져 보였다.
-- 칸 두 개를 더한다(나머지 칸·조건은 0388a 그대로 — 운영실 '학습 · 학부모 보고' 미확인 판정 `unread-filter.ts`와 같다):
--   sent_mature   = 발송 성공 · 매칭 가능 중 보낸 지 48시간이 지난 것
--   read48_mature = 그중 보낸 뒤 48시간 안에 확인한 것
-- 돌려주는 칸이 바뀌어 `create or replace`가 안 된다 — 한 트랜잭션 안에서 지우고 다시 만든다. 옛 앱은 늘어난 칸을 무시하므로 **앱보다 먼저**
-- 적용한다(#95). 권한은 0388a와 같다(명시 grant 없음 = 함수 기본값 · security invoker라 호출자 RLS + auth_tenant_id()).
-- 되돌리기: 0388a 본문을 다시 실행하기 전에 이 함수를 지운다(돌려주는 칸이 달라 create or replace로는 못 돌아간다).
begin;

drop function if exists public.lesson_report_buckets(date, date, text);

create function public.lesson_report_buckets(p_from date, p_to date, p_grain text)
returns table (bucket text, subject text, homework_score text, reports bigint, sent bigint, read48 bigint, unread bigint, sent_mature bigint, read48_mature bigint)
language sql
stable
security invoker
set search_path = public
as $$
  with r as (
    select
      report_date,
      subject,
      homework_score,
      (classnote_status = 'success'
        and (edutrix_share_token is not null or source is null or source <> 'edutrix_import')) as ok_sent,
      classnote_sent_at,
      classnote_read_at
    from lesson_reports
    where tenant_id = auth_tenant_id()
      and report_date between p_from and p_to
  )
  select
    case when p_grain = 'day' then to_char(report_date, 'YYYY-MM-DD') else to_char(report_date, 'YYYY-MM') end as bucket,
    subject,
    homework_score,
    count(*) as reports,
    count(*) filter (where ok_sent) as sent,
    count(*) filter (where ok_sent and classnote_read_at is not null and classnote_read_at <= classnote_sent_at + interval '48 hours') as read48,
    count(*) filter (where ok_sent and classnote_read_at is null and classnote_sent_at < now() - interval '48 hours') as unread,
    count(*) filter (where ok_sent and classnote_sent_at < now() - interval '48 hours') as sent_mature,
    count(*) filter (where ok_sent and classnote_sent_at < now() - interval '48 hours'
      and classnote_read_at is not null and classnote_read_at <= classnote_sent_at + interval '48 hours') as read48_mature
  from r
  group by 1, 2, 3;
$$;

commit;
