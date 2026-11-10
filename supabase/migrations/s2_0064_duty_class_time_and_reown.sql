-- s2_0064 — 업무 완성도: 수업 시간이 지난 업무만 센다 · 담당 없는 업무는 학생 집계에서도 뺀다 · 다시 만든 지난 달의 담당 바로잡기 (2026-11-11)
--
-- 왜:
--   ① 원장 2026-11-11 *"수업시간이 지났을때 반영할것. … JJ수업은 수요일 수업시간이 되지도 않았는데 벌써부터 0%임"* — 관리 화면의 %는 '기한 안에 끝낸 것 ÷ 그 기간의 전체'인데,
--      이번 주 · 이번 달을 보면 아직 열리지도 않은 수업의 출결 · 보고서까지 분모에 들어 0%로 보였다. 일간 업무는 **그 수업이 끝난 뒤부터** 센다.
--      (수업이 끝난 시각 = 출결의 기한 · 보고서는 기한 − 24시간 — 앱 `model/daily.ts`의 기한 규칙과 같은 값이다. 월간 · 건별 업무는 그 기간 내내 센다.)
--      단, 이름 옆의 '반 수 · 학생 수'(`duty_rollup_owner_load`)는 수업 전이라고 줄지 않는다 — 그 기간에 맡은 반 전부.
--   ② 원장 2026-11-11 *"담당 미정 원인 확인해보고 노출되지 않도록 숨길것 (원어민처럼)"* — 담당 없는 업무는 관리 화면에서 뺀다. 선생님 · 반 집계는 앱이 줄을 걸러 빼지만
--      학생 집계는 결과에 담당 칸이 없어 합치기 전에 빼야 한다: `p_exclude_owners`를 주면(널이 아니면) 담당 없는 것도 함께 뺀다.
--   ③ 그 '담당 미정'의 원인 — 지난 달을 다시 만들 때(`backfillDutyMonth`) 그날의 담임 · 퇴사일로 담당을 다시 정해도, `duty_upsert_items`는 **열린 행의 담당만** 고친다
--      (끝난 업무의 실적이 새 담당으로 옮겨 가지 않게 하는 평소 규칙). 그래서 먼저 '퇴사자 = 담당 없음'으로 만들어 둔 10월의 끝난 행들이 그대로 남았다(침산 126건).
--      평가 개시 전(참고 기록)의 행에 한해 담당을 다시 적는 길을 따로 둔다.
-- 무엇:
--   · `duties_private.rollup_rows(…, p_include_future boolean)` 새 겹침 — 종전 본문 + 일간 업무의 수업 시각 조건. 종전 6칸 함수는 이것을 `false`로 부른다(집계 넷이 그대로 따라온다).
--   · `duty_rollup_owner_load` — 수업 전 업무까지 포함해 센다(`true`).
--   · `duty_rollup_student_ex` — `p_exclude_owners`가 널이 아니면 담당 없는 행도 뺀다(본문 그 밖은 s2_0062 그대로).
--   · `duty_reown_items` — 평가 개시 전에 기한이 지난 **닫힌** 행의 담당 · 담당 근거만 초안대로 다시 적는다(상태 · 기한 · 완료 시각은 건드리지 않는다). 개시일이 없는 지점은 0건.
-- 연동 역할 실행권 확인: 관리 화면 집계 · 지난 달 다시 만들기는 앱 service_role만 부른다 — 연동 PC 질의·RLS 정책이 지나지 않는다(rollup_rows는 duties_private 안쪽 함수).
-- 되돌리기: ① 6칸 rollup_rows를 s2_0052 본문으로 · owner_load를 s2_0053 본문으로 ② student_ex를 s2_0062 본문으로 ③ duty_reown_items를 지운다(앱을 먼저 되돌린다).
begin;

create or replace function duties_private.rollup_rows(p_tenant uuid, p_from date, p_to date, p_subjects text[], p_periods text[], p_owner uuid, p_include_future boolean)
returns table (owner_id uuid, subject text, kind text, period text, class_id uuid, student_id uuid, due_at timestamptz,
               f_done int, f_due int, f_ontime int, f_late_done int, f_open_late int, f_expired int, f_over7 int)
language sql stable
as $fn$
  select d.owner_id, d.subject, d.kind, d.period, d.class_id, d.student_id, d.due_at,
         (d.status = 'done')::int,
         (d.due_at <= pg_catalog.now())::int,
         (d.status = 'done' and d.due_at <= pg_catalog.now() and coalesce(d.done_at, d.due_at) <= d.due_at)::int,
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

revoke all on function duties_private.rollup_rows(uuid, date, date, text[], text[], uuid, boolean) from public, anon, authenticated;
grant execute on function duties_private.rollup_rows(uuid, date, date, text[], text[], uuid, boolean) to service_role;

create or replace function duties_private.rollup_rows(p_tenant uuid, p_from date, p_to date, p_subjects text[], p_periods text[], p_owner uuid)
returns table (owner_id uuid, subject text, kind text, period text, class_id uuid, student_id uuid, due_at timestamptz,
               f_done int, f_due int, f_ontime int, f_late_done int, f_open_late int, f_expired int, f_over7 int)
language sql stable
as $fn$
  select * from duties_private.rollup_rows(p_tenant, p_from, p_to, p_subjects, p_periods, p_owner, false);
$fn$;

create or replace function public.duty_rollup_owner_load(p_tenant uuid, p_from date, p_to date, p_subjects text[], p_periods text[], p_owner uuid)
returns table (owner_id uuid, subject text, classes bigint, students bigint)
language sql stable security definer set search_path = public
as $fn$
  select r.owner_id, r.subject, count(distinct r.class_id), count(distinct r.student_id)
    from duties_private.rollup_rows(p_tenant, p_from, p_to, p_subjects, p_periods, p_owner, true) r
   group by r.owner_id, r.subject;
$fn$;

create or replace function public.duty_rollup_student_ex(p_tenant uuid, p_from date, p_to date, p_subjects text[], p_periods text[], p_owner uuid, p_kind text, p_class uuid, p_subject text, p_student uuid, p_subject_none boolean, p_owner_none boolean, p_exclude_owners uuid[])
returns table (student_id uuid, class_id uuid, kind text, total bigint, done bigint, due bigint, ontime bigint, late_done bigint, open_late bigint, expired bigint, over7 bigint, last_due timestamptz)
language sql stable security definer set search_path = public
as $fn$
  select r.student_id, r.class_id, r.kind, count(*), sum(r.f_done), sum(r.f_due), sum(r.f_ontime), sum(r.f_late_done), sum(r.f_open_late), sum(r.f_expired), sum(r.f_over7),
         max(r.due_at) filter (where r.f_open_late = 1 or r.f_expired = 1)
    from duties_private.rollup_rows(p_tenant, p_from, p_to, p_subjects, p_periods, p_owner) r
   where (p_kind is null or r.kind = p_kind)
     and (p_class is null or r.class_id = p_class)
     and (p_subject is null or r.subject = p_subject)
     and (not coalesce(p_subject_none, false) or r.subject is null)
     and (not coalesce(p_owner_none, false) or r.owner_id is null)
     and (p_student is null or r.student_id = p_student)
     -- 뺄 담당을 주면(빈 목록이어도) 담당 없는 업무도 함께 뺀다 — 관리 화면에 '담당 미정'을 세우지 않는다.
     and (p_exclude_owners is null or (r.owner_id is not null and not (r.owner_id = any(p_exclude_owners))))
   group by r.student_id, r.class_id, r.kind;
$fn$;

create or replace function public.duty_reown_items(p_tenant uuid, p_items jsonb) returns int
language plpgsql security definer set search_path = public
as $fn$
declare
  v_live timestamptz;
  v_n int := 0;
begin
  select s.live_from into v_live from public.duty_settings s where s.tenant_id = p_tenant;
  if v_live is null then return 0; end if;
  update public.duty_items d
     set owner_id = (select u.id from public.users u where u.id = x."ownerId" and u.tenant_id = p_tenant),
         owner_source = x."ownerSource", updated_at = now()
    from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as x(kind text, cycle text, "subjectKey" text, "ownerId" uuid, "ownerSource" text)
   where d.tenant_id = p_tenant and d.kind = x.kind and d.subject_key = x."subjectKey" and d.cycle = x.cycle
     and d.status <> 'open' and d.due_at < v_live
     and x."ownerSource" is not null
     and (d.owner_id, d.owner_source) is distinct from ((select u.id from public.users u where u.id = x."ownerId" and u.tenant_id = p_tenant), x."ownerSource");
  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

revoke all on function public.duty_reown_items(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.duty_reown_items(uuid, jsonb) to service_role;

commit;
