-- 0114a: 운영실 일일 AI 브리핑 (2026-07-16, 원장 승인 — 테넌트당 1콜/일 cron 사전 생성 + 명시 '다시 생성').
--
-- ① daily_briefings — 하루 1행(tenant×date 유니크 = upsert 타겟·cron 멱등). payload jsonb에는
--    결정론 신호 다이제스트(숫자·명단의 유일한 진실), narrative에는 LLM 서술(후검증 가드 통과분만).
--    상태 시멘틱: processing_status='completed'인데 narrative가 null이고 processing_error가 있으면
--    "결정론 요약은 성공, AI 서술만 실패"(카드가 '다시 생성' 표시). 'failed'는 수집 자체가 실패.
--
--    ⚠️ RLS는 켜되 **정책을 만들지 않는다**(0074a notifications 계열보다 더 좁게 — select 정책도 없음).
--    payload가 master 관점 전신호(미수 학생명·지출 결재 등)라서, tenant-wide select 정책을 붙이면
--    브라우저 anon 키로 강사가 devtools 한 줄로 전문을 읽는다(#77 "UI 조건은 게이트가 아니다").
--    읽기·쓰기 전부 서버(service_role admin client)가 역할 게이트(master/admin/manager) 통과 후 수행.
--
-- ② 세션용 대시보드 RPC의 p_tenant 변형 2종 — auth_tenant_id()는 auth.uid() 기반이라 service_role
--    (cron admin client)에서는 null → **에러 없이 0행**(silent 오보: "반 미배정 0명·반복 결석 0명"으로 위장).
--    cron 경로는 이 변형만 호출한다. execute 권한은 service_role로 한정(authenticated가 임의 p_tenant로
--    타 테넌트를 조회하는 것 차단). top_outstanding은 브리핑이 소비하지 않아 변형을 만들지 않는다(필요 시 추가).
--
-- ⚠️ drizzle journal 밖(손수 alpha). 신규 DB는 pnpm db:alphas가 사전순 적용.

create table if not exists daily_briefings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  briefing_date date not null,               -- KST 기준 '오늘'(kstToday) — UTC 날짜 사용 금지(0 22 UTC cron = 익일 07:00 KST)
  processing_status text not null default 'idle', -- idle | analyzing | completed | failed
  processing_error text,                     -- 한글 사유(완료+narrative null이면 "서술만 실패" 표시용)
  payload jsonb,                             -- DailyBriefingPayload(결정론 다이제스트 — 숫자·명단의 단일 진실)
  narrative text,                            -- LLM 서술(validateNarrative 통과분만, 실패 시 null)
  model_version text,                        -- 실사용 모델 id + 날짜(UI 미노출 정책)
  generated_at timestamptz,
  notified_at timestamptz,                   -- 알림 1회 게이트(그날 최초 생성 시에만 발송 — 재생성은 미발송)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), -- '다시 생성' 원자 claim의 5분 stuck 판정 기준
  unique (tenant_id, briefing_date)
);

create index if not exists daily_briefings_tenant_date_idx
  on daily_briefings (tenant_id, briefing_date desc);

alter table daily_briefings enable row level security;
-- 정책 없음(의도) — service_role만 통과. 위 헤더 주석 참조.

drop trigger if exists daily_briefings_set_updated_at on daily_briefings;
create trigger daily_briefings_set_updated_at
  before update on daily_briefings
  for each row execute function tg_set_updated_at();

-- ── p_tenant 변형 RPC (cron/service_role 전용) ──────────────────────────────

create or replace function public.dashboard_unassigned_enrolled_admin(p_limit int, p_tenant uuid)
returns table (student_id uuid, student_name text, grade text, school text, enrolled_at date)
language sql
stable
security invoker
set search_path = public
as $$
  select s.id, s.name, s.grade, s.school, s.enrolled_at
  from students s
  where s.tenant_id = p_tenant
    and s.status = 'enrolled'
    and not exists (
      select 1 from enrollments e
      where e.student_id = s.id
        and (e.end_date is null or e.end_date >= current_date))
  order by s.enrolled_at desc nulls last
  limit p_limit;
$$;

revoke all on function public.dashboard_unassigned_enrolled_admin(int, uuid) from public;
revoke all on function public.dashboard_unassigned_enrolled_admin(int, uuid) from anon;
revoke all on function public.dashboard_unassigned_enrolled_admin(int, uuid) from authenticated;
grant execute on function public.dashboard_unassigned_enrolled_admin(int, uuid) to service_role;

comment on function public.dashboard_unassigned_enrolled_admin(int, uuid) is
  '0097a dashboard_unassigned_enrolled의 cron(service_role) 변형 — auth_tenant_id() 대신 p_tenant. execute는 service_role만.';

create or replace function public.dashboard_absence_risk_admin(p_min int, p_tenant uuid)
returns table (student_id uuid, student_name text, absences bigint)
language sql
stable
security invoker
set search_path = public
as $$
  with anchor as (
    select max(session_date) as d
    from attendance_records
    where tenant_id = p_tenant
  ),
  effective as (
    select distinct on (a.student_id, a.class_id, a.session_date)
      a.tenant_id,
      a.student_id,
      a.class_id,
      a.session_date,
      a.status
    from attendance_records a
    cross join anchor
    where a.tenant_id = p_tenant
      and anchor.d is not null
      and a.session_date >= anchor.d - interval '13 days'
      and a.session_date <= anchor.d
    order by a.student_id, a.class_id, a.session_date, a.recorded_at desc, a.id desc
  )
  select
    s.id as student_id,
    s.name as student_name,
    count(*) as absences
  from effective a
  join students s on s.id = a.student_id and s.tenant_id = a.tenant_id
  where a.status = 'absent'
  group by s.id, s.name
  having count(*) >= p_min
  order by absences desc;
$$;

revoke all on function public.dashboard_absence_risk_admin(int, uuid) from public;
revoke all on function public.dashboard_absence_risk_admin(int, uuid) from anon;
revoke all on function public.dashboard_absence_risk_admin(int, uuid) from authenticated;
grant execute on function public.dashboard_absence_risk_admin(int, uuid) to service_role;

comment on function public.dashboard_absence_risk_admin(int, uuid) is
  '0110a dashboard_absence_risk의 cron(service_role) 변형 — auth_tenant_id() 대신 p_tenant. execute는 service_role만.';
