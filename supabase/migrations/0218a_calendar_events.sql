-- 0218a — 캘린더 탭(학원 일정) 도입
--
-- 원장(2026-08-18): *"일단 캘린더 탭으로 우리 프로그램 내에 일정부터 관리 정리하자"* — 초기 결정
-- "캘린더 비이식(영구 제외)"을 원장이 명시 재검토로 뒤집었다(전자결재 휴가→캘린더 논의에서 출발).
--
-- 🔑 구조 결정: **eywa DB가 일정의 단일 진실.** 구글 캘린더 상시 동기화는 하지 않는다(양방향 동기화는
--    여전히 영구 제외 — split-brain·웹훅 갱신 지옥). 구글은 추후 ① 1회 임포트(이사) 또는 ② 단방향
--    미러(eywa→구글 복사, 폰 알림용) 중 원장이 고르면 그때 붙인다. 지금은 순수 내부 일정.
--
-- 표 하나: 학원(테넌트) 공용 일정. 종일 일정이 기본이고 시간은 선택(학원 일정은 "8/21 여름특강"처럼
-- 날짜 단위가 대부분 — 시간표·교시는 별도 시스템이 이미 담당하므로 여기 안 섞는다).
--
-- ⚠️ 읽기 RLS = 테넌트 전원(학원 일정은 직원 공용 정보 — 급여·상담 같은 민감 축이 없다).
--    메뉴 노출·쓰기 권한은 앱 게이트(canWriteTenant "calendar")가 담당, 쓰기는 서버 액션(service_role) 전용.
-- 롤백: drop table public.calendar_events;
set local statement_timeout = '60s';

create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  title text not null constraint calendar_events_title_len check (char_length(title) between 1 and 120),
  memo text,
  start_date date not null,
  end_date date not null,
  constraint calendar_events_range_ordered check (end_date >= start_date),
  -- 시간은 선택(HH:MM) — 종일 일정이면 null. 시작만 있고 끝이 없는 것도 허용("15:00 회의").
  start_time time,
  end_time time,
  -- 표시 색 — 앱의 Pill 팔레트 키(코드가 검증·매핑, DB는 잠그지 않는다: 팔레트 확장 시 마이그 없이).
  color text not null default 'primary',
  -- 만든 사람(표시·감사용). 계정 삭제 시 일정은 남긴다(학원 일정은 개인 소유물이 아니다).
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.calendar_events is
  '학원 공용 일정(캘린더 탭) — eywa DB가 단일 진실(구글 상시 동기화 없음, 0218a 머리 주석). 날짜 단위 기본 + 시간 선택. 쓰기는 서버 액션 전용.';

-- 월 뷰 조회가 유일한 핫패스: 구간 겹침(start_date <= 월말 AND end_date >= 월초).
create index if not exists calendar_events_tenant_start_idx
  on public.calendar_events (tenant_id, start_date);
create index if not exists calendar_events_tenant_end_idx
  on public.calendar_events (tenant_id, end_date);

alter table public.calendar_events enable row level security;

-- 읽기 = 테넌트 전원(위 주석 — 학원 일정은 공용 정보). 쓰기 정책 없음(서버 액션 전용).
drop policy if exists calendar_events_tenant_read on public.calendar_events;
create policy calendar_events_tenant_read on public.calendar_events
  for select
  using (tenant_id = public.auth_tenant_id());

drop trigger if exists calendar_events_set_updated_at on public.calendar_events;
create trigger calendar_events_set_updated_at
  before update on public.calendar_events
  for each row execute function public.tg_set_updated_at();

notify pgrst, 'reload schema';
