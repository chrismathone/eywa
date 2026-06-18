-- 0027a — 태블릿 출석 키오스크 (데모 시뮬레이션) 스키마.
-- ⚠️ 손수 alpha 파일: drizzle migrate 대신 raw 적용한다(병렬 세션의 미커밋 0026/_journal 충돌 회피).
--    전부 멱등(IF NOT EXISTS / drop+create). 병합 시점에 drizzle generate로 정식 번호본을 재산출.
-- 의존: 0001a의 public.auth_tenant_id(), public.tg_set_updated_at().

begin;

-- A. enum: 출결/등하원 입력 경로 -------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'attendance_access_method') then
    create type public.attendance_access_method as enum ('manual', 'kiosk');
  end if;
end $$;

-- B. students — 학생 휴대폰 + 출석번호 ------------------------------------------
alter table public.students add column if not exists student_phone text;
alter table public.students add column if not exists attendance_code text;

create index if not exists students_attendance_code_idx
  on public.students (tenant_id, attendance_code);

-- 출석번호 부분 유니크: 재원(비퇴원) 학생 범위에서 (tenant_id, attendance_code) 유일.
create unique index if not exists ux_students_attendance_code_active
  on public.students (tenant_id, attendance_code)
  where status <> 'withdrawn' and attendance_code is not null;

-- C. attendance_records — 키오스크 'present' 반영 허용 ---------------------------
-- 키오스크 셀프 체크인이 present로 반영하는 행은 입력 직원이 없으므로 recorded_by NULL 허용.
alter table public.attendance_records alter column recorded_by drop not null;
alter table public.attendance_records
  add column if not exists access_method public.attendance_access_method;

-- D. attendance_checkins — 등하원(현관 출입, 시각) -------------------------------
create table if not exists public.attendance_checkins (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  checkin_date date not null,
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  access_method public.attendance_access_method not null default 'kiosk',
  device_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists checkins_tenant_student_date_idx
  on public.attendance_checkins (tenant_id, student_id, checkin_date);

-- E. kiosk_devices — 기기 등록(디바이스 토큰 바인딩) -----------------------------
create table if not exists public.kiosk_devices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  token_hash text not null,
  is_active boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists kiosk_devices_tenant_idx on public.kiosk_devices (tenant_id);
create unique index if not exists kiosk_devices_token_hash_idx on public.kiosk_devices (token_hash);

-- F. attendance_notifications — 등하원 발송 로그(데모=시뮬레이션) ----------------
create table if not exists public.attendance_notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  checkin_id uuid,
  kind text not null,
  recipient_masked text,
  message text not null,
  channel text not null default 'simulated',
  status text not null default 'simulated',
  created_at timestamptz not null default now()
);
create index if not exists attendance_notifications_tenant_created_idx
  on public.attendance_notifications (tenant_id, created_at);

-- G. RLS — 신규 3테이블 tenant 격리(0001a 템플릿 그대로) -------------------------
-- service_role(체크인 API)은 RLS 우회. 정책은 authenticated(원장 설정 페이지 읽기)용 방어선.
do $$
declare t text;
begin
  foreach t in array array['attendance_checkins', 'kiosk_devices', 'attendance_notifications']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_tenant_isolation on public.%I', t, t);
    execute format(
      'create policy %I_tenant_isolation on public.%I
         for all to authenticated
         using (tenant_id = public.auth_tenant_id())
         with check (tenant_id = public.auth_tenant_id())',
      t, t
    );
  end loop;
end $$;

-- updated_at 트리거(attendance_checkins만 updated_at 보유)
drop trigger if exists attendance_checkins_set_updated_at on public.attendance_checkins;
create trigger attendance_checkins_set_updated_at
  before update on public.attendance_checkins
  for each row execute function public.tg_set_updated_at();

commit;
