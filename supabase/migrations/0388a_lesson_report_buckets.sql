-- 학습·학부모 보고 추이 RPC(원장 2026-10-20 *"상세 눌렀을때 추이를 볼 수 없는곳 모두 추가해보자"*) — 보고서 통계 화면이 칸(날 · 달 —
-- 수업일 `report_date` 기준) × 과목 × 숙제 값마다 건수를 받는다. 보고서가 달마다 2천 건이라 전건 fetch 대신 DB group-by(B2).
-- 🔑 숙제 값은 **원문 그대로** 묶어 돌려준다 — 숫자 판정은 앱의 `parseHomeworkRate` 하나다(SQL에 규칙을 다시 쓰면 두 벌이 된다).
--    값 종류가 스무 개 남짓이라 행 수가 작다.
-- 🔑 학부모 확인은 운영실 '학습 · 학부모 보고'의 미확인 판정(`getUnreadReports` · `unread-filter.ts`)과 같은 조건:
--    발송 성공(`classnote_status = 'success'`) · 매칭 가능(공유 토큰이 있거나 옛 이관분이 아님) · 발송 후 48시간.
--    sent = 그 조건의 발송 건 · read48 = 발송 후 48시간 안에 확인 · unread = 지금도 미확인이고 발송 후 48시간이 지났다(카드가 세는 것).
-- security invoker(호출자 RLS) + 명시적 auth_tenant_id()(0039a·0040a 패턴).
create or replace function public.lesson_report_buckets(p_from date, p_to date, p_grain text)
returns table (bucket text, subject text, homework_score text, reports bigint, sent bigint, read48 bigint, unread bigint)
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
    count(*) filter (where ok_sent and classnote_read_at is null and classnote_sent_at < now() - interval '48 hours') as unread
  from r
  group by 1, 2, 3;
$$;

-- 운영 콘솔 '원장 화면 열기'(0356a) 중에도 읽을 수 있게 — 앱 쪽 읽기 목록(`TENANT_VIEW_READ_RPCS`)에 같은 이름을 올렸다(stable 함수만).
