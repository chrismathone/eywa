-- s2_0091 — 업무 완성도: '때가 된 업무'만 등급 · 전체에 든다 (2026-11-11)
--
-- 왜: s2_0090로 아직 열리지 않은 수업의 업무는 뺐지만, 학생 상담 · 월말평가(말일 기한) · 신규생 관리(항목의 날)는 달 초부터 분모에 들어
--   진행 중인 달에는 잘하는 선생님도 5~7등급으로 보였다(침산 11월 11일 — 전체 36% · 6등급). 원장에게 물었고 *"추천으로 진행"*:
--   **기한이 정해진 업무(월간 · 건별)는 그 기한이 지난 뒤부터** 등급 · 전체에 넣는다. 그 전의 진행(몇 건 중 몇 건)은 화면이 색 없이 따로 보인다.
--   일간 업무는 s2_0090 그대로 **수업이 끝난 뒤부터**다(보고서는 수업이 끝나면 들어가고, 기한(+24시간) 전까지는 '남음'으로 분모에 든다 —
--   원장 *"수업시간이 지났을때 반영할것"* · *"남음이 있는데 100%는 말도 안됨"*).
-- 무엇: `duties_private.rollup_rows`(7칸)의 두 표식만 바꾼다 — 집계 함수들의 반환 모양은 그대로다.
--   · f_due   = 때가 됨(일간 = 수업 끝 ≤ 지금 · 월간/건별 = 기한 ≤ 지금)          ← 종전: 기한 ≤ 지금
--   · f_ontime = 때가 된 것 가운데 기한 안에 끝낸 것                              ← 종전: 기한이 지난 것 가운데 제때 끝낸 것
--   그래서 집계의 `due` = 등급 · %의 분모, `ontime` = 분자가 된다. 아직 때가 안 된 월간 · 건별 업무는 `total − due`로 남아 진행만 보인다.
--   나머지 표식(끝남 · 기한 후 완료 · 기한 초과 · 미이행 확정 · 7일 초과)과 걸러내기는 s2_0090 그대로.
-- 연동 역할 실행권 확인: 본문만 바꾼다(실행권 변경 없음) — 관리 화면 집계는 앱 service_role만 부른다.
-- 되돌리기: s2_0090의 7칸 rollup_rows 본문으로.
begin;

create or replace function duties_private.rollup_rows(p_tenant uuid, p_from date, p_to date, p_subjects text[], p_periods text[], p_owner uuid, p_include_future boolean)
returns table (owner_id uuid, subject text, kind text, period text, class_id uuid, student_id uuid, due_at timestamptz,
               f_done int, f_due int, f_ontime int, f_late_done int, f_open_late int, f_expired int, f_over7 int)
language sql stable
as $fn$
  select d.owner_id, d.subject, d.kind, d.period, d.class_id, d.student_id, d.due_at,
         (d.status = 'done')::int,
         ((case when d.period = 'daily' and d.kind in ('report_send', 'report_write') then d.due_at - interval '24 hours' else d.due_at end) <= pg_catalog.now())::int,
         (d.status = 'done' and coalesce(d.done_at, d.due_at) <= d.due_at
            and (case when d.period = 'daily' and d.kind in ('report_send', 'report_write') then d.due_at - interval '24 hours' else d.due_at end) <= pg_catalog.now())::int,
         (d.status = 'done' and d.due_at <= pg_catalog.now() and d.done_at > d.due_at)::int,
         (d.status = 'open' and d.due_at <= pg_catalog.now())::int,
         (d.status = 'void' and d.void_reason = 'expired')::int,
         (d.status = 'open' and d.due_at + interval '7 days' < pg_catalog.now())::int
    from public.duty_items d
   where d.tenant_id = p_tenant
     and (d.status <> 'void' or d.void_reason = 'expired')
     and (d.due_at >= coalesce((select s.live_from from public.duty_settings s where s.tenant_id = p_tenant), '-infinity'::timestamptz)
          or p_to < (select (s.live_from at time zone 'Asia/Seoul')::date from public.duty_settings s where s.tenant_id = p_tenant))
     and (p_subjects is null or d.subject = any(p_subjects))
     and (p_owner is null or d.owner_id = p_owner)
     and duties_private.rollup_window(d.period, d.cycle, d.status, d.due_at, d.done_at, p_from, p_to, p_periods)
     -- 일간 업무는 그 수업이 끝난 뒤부터(출결 기한 = 수업 끝 · 보고서 기한 = 수업 끝 + 24시간).
     and (p_include_future or d.period <> 'daily'
          or (case when d.kind in ('report_send', 'report_write') then d.due_at - interval '24 hours' else d.due_at end) <= pg_catalog.now());
$fn$;

commit;
