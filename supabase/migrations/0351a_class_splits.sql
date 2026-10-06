-- 0351a — 수업 나누기 (한 학생의 수업 일부 시간을 다른 선생님 반에서)
--
-- 원장(2026-10-06): *"학생이 지금 현재 중복반을 못가지는데 잠시 맡아주거나 하는 경우 ex) 화금 이성우 수업 3시간에서
-- 1시간만 유형숙으로 넘긴다던지"* → 이름 *"반이동이 아니라 수업나누기"* → *"출결은 맡아진 시간에는 그 선생님 몫,
-- 수강료는 원래반 기준 · 시간은 과목 단위(수학 1시간 · EiE 40분)로 시작 시각과 길이 · 기간은 일별·월별·영구 ·
-- 수업보고서는 원래반 담임 · 겹치면 안내하고 확인하면 진행 · 나누는 건 매우 상급자만"*.
--
-- 🔑 구조 결정:
--   ① **수강(enrollments)이 아니다.** 나눈 시간 때문에 받는 반에 수강행을 만들면 인원·청구(회차 N)·재원 집계·
--      학생 목록·담임 보고서 대상이 전부 그 행을 센다. 수강료는 원래 반 기준이라는 결정과 정면 충돌하므로
--      **표를 따로 둔다**(0264a 보강 예약과 같은 결). 원래 수강은 한 글자도 안 바뀐다.
--   ② **요일마다 한 행**(화·금이면 두 행) — 요일×시각 단위로 시간표 칸에 붙고 출석부가 날짜로 찾는다.
--   ③ 시각은 **스냅샷**(`start_time`·`end_time`) — 뒤에 시간표가 바뀌어도 나누던 그 시각으로 읽힌다.
--      맞는 칸이 없어지면 화면은 안 그린다(지어내지 않는다).
--   ④ 기간 = `valid_from` ~ `valid_to`(포함, null = 영구). `period_kind`는 사람이 고른 단위(일별·월별·영구)를 표시용으로 남긴다.
--
-- 🔴 유니크는 **일반 유니크**(부분 유니크 금지, [[#113]]) — 해제는 행을 **지운다**(감사로그에 내용을 남긴다).
-- 🔴 `auth_menu_access(...)`를 RLS에 쓰지 말 것([[#92]]). 읽기 = 테넌트 격리(select 정책), 쓰기 = 서버 액션(service_role)
--    + 앱 게이트(특수 권한 명단 + super_admin, `class-splits/access.ts`).
-- 🔴 정책을 하나도 안 만들면 세션 클라이언트로 **에러 없이 0행**이다([[#104]]) → select 정책을 만든다.
-- ⚠️ 앱은 이 SQL 적용 전에도 죽지 않는다([[#95]]) — 표가 없으면 조회는 빈 목록이고, 나누기 저장만 한글 오류로 거절된다.
--
-- 롤백:
--   drop table if exists public.class_splits;
set local statement_timeout = '60s';

create table if not exists public.class_splits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  -- 원래 반(수강료·보고서 기준). 반이 지워지면 나눔도 뜻을 잃는다.
  source_class_id uuid not null references public.classes(id) on delete cascade,
  -- 그 시간에 학생이 가는 반(출결 귀속).
  target_class_id uuid not null references public.classes(id) on delete cascade,
  day_of_week text not null
    constraint class_splits_dow_chk check (day_of_week in ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')),
  start_time time not null,
  end_time time not null,
  valid_from date not null,
  -- null = 영구(해제하기 전까지).
  valid_to date,
  period_kind text not null default 'forever'
    constraint class_splits_kind_chk check (period_kind in ('day', 'month', 'forever')),
  note text constraint class_splits_note_len check (note is null or char_length(note) <= 300),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint class_splits_classes_differ check (source_class_id <> target_class_id),
  constraint class_splits_time_order check (end_time > start_time),
  constraint class_splits_date_order check (valid_to is null or valid_to >= valid_from),
  -- 🔴 일반 유니크(부분 유니크 금지, [[#113]]).
  constraint class_splits_uniq unique (tenant_id, student_id, source_class_id, day_of_week, start_time, valid_from)
);

comment on table public.class_splits is
  '수업 나누기(0351a). 수강이 아니다 — 인원·청구·재원 집계에 닿지 않는다. 그 시간 출결만 받는 반 몫.';

-- 시간표(주 범위 × 화면의 반들) · 출석부(반 × 날짜) — 양쪽 반 축 모두
create index if not exists class_splits_source_idx on public.class_splits (tenant_id, source_class_id);
create index if not exists class_splits_target_idx on public.class_splits (tenant_id, target_class_id);
-- 학생 상세 · 겹침 확인
create index if not exists class_splits_student_idx on public.class_splits (tenant_id, student_id);

alter table public.class_splits enable row level security;

drop policy if exists class_splits_tenant_read on public.class_splits;
create policy class_splits_tenant_read on public.class_splits
  for select using (tenant_id = public.auth_tenant_id());

drop trigger if exists class_splits_set_updated_at on public.class_splits;
create trigger class_splits_set_updated_at before update on public.class_splits
  for each row execute function public.tg_set_updated_at();
