-- 0124a_onescreen_parent_read_stats.sql (손수 alpha)
-- G3 "안 읽은 학부모 노출" — 강사 원스크린 로스터에 학생별 학부모 읽음 통계를 붙인다.
-- 주 신호 = lesson_reports.classnote_read_at(0122a 읽음 동기화, ClassNote read_by_parent 실측 커버리지 75%).
-- 분모(추적 가능) = 발송이 실재한 행: edutrix_share_token IS NOT NULL(edutrix 발송분, 07-13주부터 백필)
--   OR classnote_sent_at IS NOT NULL(eywa 자체발송분). 그 밖(옛 이관분)은 읽음 신호가 원천 부재라 분모 제외 —
--   토큰 유무가 곧 시대 컷오프라 별도 날짜 컷오프 불필요(2026-07-19 실측: 07-06주 이전 trackable 0).
-- "aged" = report_date가 4일+ 지난 행 — 읽힘은 발송 뒤 며칠에 걸쳐 채워지므로(실측 3일 93%) 갓 보낸 건
--   미확인으로 세지 않는다. 판정(배지 여부)은 앱 순수 함수가 담당, RPC는 집계만.
-- 학생별 group-by 1행 반환(수십 행, 절단 불가) — bare 전건 fetch는 B2 위반이라 RPC(0039a/0040a/0117a 패턴).
-- security invoker + auth_tenant_id() 이중격리. ⚠️ drizzle journal 밖(손수 alpha) — pnpm db:alphas가 사전순 적용.

create or replace function onescreen_parent_read_stats(p_student_ids uuid[], p_recent int default 5)
returns table (
  student_id uuid,
  trackable_count int,      -- 최근 p_recent건 중 추적 가능 행 수
  aged_unread_count int,    -- 그중 4일+ 경과했는데 미읽음(확정 미확인 후보)
  read_count int,           -- 그중 읽음
  last_read_at timestamptz  -- 최근 p_recent건 밖 포함, 이 학생 보고서의 마지막 읽음 시각(전무면 null)
)
language sql
stable
security invoker
set search_path = public
as $$
  with recent as (
    select r.student_id, r.classnote_read_at, r.report_date,
      row_number() over (partition by r.student_id order by r.report_date desc, r.id desc) as rn
    from lesson_reports r
    where r.tenant_id = auth_tenant_id()
      and r.student_id = any(p_student_ids)
      and (r.edutrix_share_token is not null or r.classnote_sent_at is not null)
  )
  select
    s.sid as student_id,
    coalesce(t.trackable, 0)::int as trackable_count,
    coalesce(t.aged_unread, 0)::int as aged_unread_count,
    coalesce(t.readc, 0)::int as read_count,
    lr.last_read_at
  from unnest(p_student_ids) as s(sid)
  left join (
    select student_id,
      count(*) as trackable,
      count(*) filter (where classnote_read_at is null and report_date <= current_date - 4) as aged_unread,
      count(*) filter (where classnote_read_at is not null) as readc
    from recent where rn <= p_recent
    group by student_id
  ) t on t.student_id = s.sid
  left join lateral (
    select max(classnote_read_at) as last_read_at from recent r2 where r2.student_id = s.sid
  ) lr on true
$$;
