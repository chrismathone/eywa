-- 0365a — 직원 출퇴근(강사평가 '강사 근태').
--
-- 원장 2026-10-13(계획서 결정 9): 근태 = 출퇴근 기록부 기준 — 지금은 메이크에듀 출퇴근 기록을 연동 PC가 가져온다. 나중에 학원
-- 키오스크가 aywa와 이어지면 같은 표로 들어온다(source). 연차·결재된 휴가·휴원일은 지각·결근에서 뺀다(집계 때 — 법정 휴가 감점 금지).
--
--  · staff_attendance_days = 직원 × 날짜 한 줄(출근·퇴근 시각 · 상태 · 늦은 분). 같은 출처의 같은 원본 줄은 한 번만(source_key — 다시 가져와도 겹치지 않는다).
--    status: present(정상) · late(지각) · absent(결근) · leave(휴가) · off(쉬는 날). 지각 판정은 원본(메이크에듀)의 표시를 그대로 옮긴다.
--  · RLS는 켜되 정책은 없다 — 지금은 서버(service_role)만 읽고 쓴다. 연동 PC가 메이크에듀 출퇴근을 가져오는 단계에서 그 역할(eywa_sync_agent)의
--    지점 경계 정책 4문장(20261008101000 모양)을 따로 더한다 — 메이크에듀 출퇴근 화면을 확인한 뒤.
--
-- 멱등 · 앱은 이 SQL 전에도 돈다(표가 없으면 근태는 원장 월 입력만 쓴다 — #95).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table if not exists public.staff_attendance_days (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  work_date date not null,
  check_in_at timestamptz,
  check_out_at timestamptz,
  status text not null check (status in ('present', 'late', 'absent', 'leave', 'off')),
  late_minutes integer check (late_minutes is null or late_minutes between 0 and 1440),
  source text not null check (source in ('makeedu', 'kiosk', 'manual')),
  source_key text not null check (char_length(source_key) between 1 and 200),
  note text check (note is null or char_length(note) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists staff_attendance_days_source_uidx on public.staff_attendance_days (tenant_id, source, source_key);
create index if not exists staff_attendance_days_user_day_idx on public.staff_attendance_days (tenant_id, user_id, work_date);
alter table public.staff_attendance_days enable row level security;
revoke all on public.staff_attendance_days from public, anon, authenticated;
grant all on public.staff_attendance_days to service_role;
comment on table public.staff_attendance_days is
  '직원 출퇴근(직원 × 날짜) — 강사평가 근태. 메이크에듀(연동 PC) · 키오스크 · 직접 입력. service_role 전용.';

notify pgrst, 'reload schema';
commit;
