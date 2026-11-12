-- s2_0075 — 업무 완성도 관리자 화면(과목 관리자 · 원장)의 집계 3종. 의무 장부(s2_0069)를 DB가 센다(B2 — 수천 행을 JS로 끌어오지 않는다).
--   duty_rollup_owner_kind : 담당자 × 과목 × 종류 × 주기 (선생님 매트릭스 · 과목 칩은 앱이 subject 열로 거른다)
--   duty_rollup_class      : 반 × 담당자 × 과목            (반별 보기)
--   duty_rollup_student    : 학생 × 반 × 종류               (드릴다운 — 담당자·종류·반·과목 중 아무거나로 좁힌다)
-- 회차 창 = duties_private.rollup_window 한 곳: 일간 = 날짜 · 주간 = ISO 주 · 월간 = 달 · 건별(신규생 콜) = 창이 오늘을 품으면 열린 것 전부(강사 홈
-- '이번 달'과 같다) · 지난 창이면 그 창 끝까지 기한이던 열린 것 · 그 창 안에 끝난 것. p_periods(null = 전부)로 '오늘·이번 주'는 일간만 센다(강사 홈과 같은 셈).
-- 'late' = 열린 채 기한 지남 + 기한 지남 확정(expired) · 'escalated' = 원장 단계(escalation >= 3)까지 간 열린 의무.
-- p_subjects(null = 전 과목 · 과목 관리자는 담당 과목 키) · p_owner(null = 전원 · '담당' 권한은 본인만).
-- service_role 전용(정책 0개 표와 같은 문) — 사람 확인은 앱(requireAccess('duties') + 과목 범위)이 먼저 한다.
-- 2026-11-10 재적용: 첫 판(인자 4개)은 신규생 콜 완료를 못 세고 오늘 창에 월간 의무를 섞었다 — 옛 서명을 지우고 다시 만든다.
begin;

drop function if exists public.duty_rollup_owner_kind(uuid, date, date, text[]);
drop function if exists public.duty_rollup_class(uuid, date, date, text[]);
drop function if exists public.duty_rollup_student(uuid, date, date, text[], uuid, text, uuid);
drop function if exists public.duty_rollup_student(uuid, date, date, text[], text[], uuid, text, uuid, text);
drop function if exists public.duty_rollup_student(uuid, date, date, text[], text[], uuid, text, uuid, text, uuid);

-- 🔴 SET 절(search_path) 없이 둔다 — SET이 붙은 SQL 함수는 계획기가 인라인하지 못해 행마다 호출된다(#143 · 재리뷰 2026-11-10). 본문은 내장 함수뿐이라 pg_catalog로 적는다.
create or replace function duties_private.rollup_window(p_period text, p_cycle text, p_status text, p_due timestamptz, p_done timestamptz, p_from date, p_to date, p_periods text[])
returns boolean language sql stable
as $fn$
  select (p_periods is null or p_period = any(p_periods)) and (
       (p_period = 'daily' and p_cycle between p_from::text and p_to::text)
    or (p_period = 'weekly' and p_cycle between pg_catalog.to_char(p_from, 'IYYY-"W"IW') and pg_catalog.to_char(p_to, 'IYYY-"W"IW'))
    or (p_period = 'monthly' and p_cycle between pg_catalog.to_char(p_from, 'YYYY-MM') and pg_catalog.to_char(p_to, 'YYYY-MM'))
    or (p_period = 'case' and (
          (p_status = 'open' and (p_to >= (pg_catalog.now() at time zone 'Asia/Seoul')::date or p_due < ((p_to + 1)::timestamp at time zone 'Asia/Seoul')))
       or (p_status = 'done' and p_done >= (p_from::timestamp at time zone 'Asia/Seoul') and p_done < ((p_to + 1)::timestamp at time zone 'Asia/Seoul'))))
  );
$fn$;

create or replace function public.duty_rollup_owner_kind(p_tenant uuid, p_from date, p_to date, p_subjects text[], p_periods text[], p_owner uuid)
returns table (owner_id uuid, subject text, kind text, period text, total bigint, done bigint, late bigint, escalated bigint)
language sql stable security definer set search_path = public
as $fn$
  select d.owner_id, d.subject, d.kind, d.period,
         count(*) filter (where d.status <> 'void' or d.void_reason = 'expired'),
         count(*) filter (where d.status = 'done'),
         count(*) filter (where (d.status = 'open' and d.due_at < now()) or d.void_reason = 'expired'),
         count(*) filter (where d.status = 'open' and d.escalation >= 3)
    from public.duty_items d
   where d.tenant_id = p_tenant
     and (p_subjects is null or d.subject = any(p_subjects))
     and (p_owner is null or d.owner_id = p_owner)
     and duties_private.rollup_window(d.period, d.cycle, d.status, d.due_at, d.done_at, p_from, p_to, p_periods)
   group by d.owner_id, d.subject, d.kind, d.period;
$fn$;

create or replace function public.duty_rollup_class(p_tenant uuid, p_from date, p_to date, p_subjects text[], p_periods text[], p_owner uuid)
returns table (class_id uuid, owner_id uuid, subject text, total bigint, done bigint, late bigint, escalated bigint)
language sql stable security definer set search_path = public
as $fn$
  select d.class_id, d.owner_id, d.subject,
         count(*) filter (where d.status <> 'void' or d.void_reason = 'expired'),
         count(*) filter (where d.status = 'done'),
         count(*) filter (where (d.status = 'open' and d.due_at < now()) or d.void_reason = 'expired'),
         count(*) filter (where d.status = 'open' and d.escalation >= 3)
    from public.duty_items d
   where d.tenant_id = p_tenant
     and (p_subjects is null or d.subject = any(p_subjects))
     and (p_owner is null or d.owner_id = p_owner)
     and duties_private.rollup_window(d.period, d.cycle, d.status, d.due_at, d.done_at, p_from, p_to, p_periods)
   group by d.class_id, d.owner_id, d.subject;
$fn$;

create or replace function public.duty_rollup_student(p_tenant uuid, p_from date, p_to date, p_subjects text[], p_periods text[], p_owner uuid, p_kind text, p_class uuid, p_subject text, p_student uuid, p_subject_none boolean)
returns table (student_id uuid, class_id uuid, kind text, total bigint, done bigint, late bigint, escalated bigint, last_due timestamptz)
language sql stable security definer set search_path = public
as $fn$
  select d.student_id, d.class_id, d.kind,
         count(*) filter (where d.status <> 'void' or d.void_reason = 'expired'),
         count(*) filter (where d.status = 'done'),
         count(*) filter (where (d.status = 'open' and d.due_at < now()) or d.void_reason = 'expired'),
         count(*) filter (where d.status = 'open' and d.escalation >= 3),
         max(d.due_at) filter (where (d.status = 'open' and d.due_at < now()) or d.void_reason = 'expired')
    from public.duty_items d
   where d.tenant_id = p_tenant
     and (p_subjects is null or d.subject = any(p_subjects))
     and (p_owner is null or d.owner_id = p_owner)
     and (p_kind is null or d.kind = p_kind)
     and (p_class is null or d.class_id = p_class)
     and (p_subject is null or d.subject = p_subject)
     and (not coalesce(p_subject_none, false) or d.subject is null)
     and (p_student is null or d.student_id = p_student)
     and duties_private.rollup_window(d.period, d.cycle, d.status, d.due_at, d.done_at, p_from, p_to, p_periods)
   group by d.student_id, d.class_id, d.kind;
$fn$;

revoke all on function duties_private.rollup_window(text, text, text, timestamptz, timestamptz, date, date, text[]),
  public.duty_rollup_owner_kind(uuid, date, date, text[], text[], uuid), public.duty_rollup_class(uuid, date, date, text[], text[], uuid),
  public.duty_rollup_student(uuid, date, date, text[], text[], uuid, text, uuid, text, uuid, boolean) from public, anon, authenticated;
grant execute on function duties_private.rollup_window(text, text, text, timestamptz, timestamptz, date, date, text[]),
  public.duty_rollup_owner_kind(uuid, date, date, text[], text[], uuid), public.duty_rollup_class(uuid, date, date, text[], text[], uuid),
  public.duty_rollup_student(uuid, date, date, text[], text[], uuid, text, uuid, text, uuid, boolean) to service_role;

notify pgrst, 'reload schema';
commit;
