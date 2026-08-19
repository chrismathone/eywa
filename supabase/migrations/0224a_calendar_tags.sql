-- 0224a — 캘린더 태그(일정 분류 + 태그별 색)
--
-- 원장(2026-08-19): *"일정을 태그를 부여해서 태그별 일정색상을 부여하고 … 자료분석 및 조사할 수 있도록
-- 캘린더를 여러가지 버전으로 볼 수 있게"* — 연간 일정 시트 임포트와 함께 도입.
--
-- 🔑 구조: 태그는 테넌트 사전(`calendar_tags`) + 일정이 FK(`tag_id`)로 참조. 색을 일정마다 복제하지
--    않고 태그에 한 번만 두므로 "태그 색 바꾸면 그 태그 일정 전부"가 자동으로 따라온다.
--    표시색 규칙은 앱 단일 소스(types.ts eventDisplayColor): 태그가 있으면 태그색, 없으면 일정 색.
--    태그 삭제 = 일정은 남고 tag_id만 null(on delete set null — 일정이 개인 소유물이 아니듯 분류도 부가물).
--
-- ⚠️ 앱은 이 마이그레이션 없이도 죽지 않는다([[#95]] expand/contract): 조회는 태그 임베드 실패 시
--    태그 없는 select로 재시도, 태그 목록은 빈 배열 폴백(태그 UI가 조용히 접힘), 일정 저장은
--    폼에 태그 필드가 있을 때만 tag_id를 보낸다.
--
-- 롤백: alter table public.calendar_events drop column if exists tag_id;
--       drop table if exists public.calendar_tags;
set local statement_timeout = '60s';

create table if not exists public.calendar_tags (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null constraint calendar_tags_name_len check (char_length(name) between 1 and 30),
  -- 앱 Pill 팔레트 키(EVENT_COLORS) — 코드가 검증·매핑, DB는 안 잠근다(팔레트 확장 시 마이그 없이).
  color text not null default 'primary',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_tags_name_unique unique (tenant_id, name)
);

comment on table public.calendar_tags is
  '캘린더 일정 태그(테넌트 사전) — 태그별 색·연간/목록/분석 뷰의 분류 축(0224a). 쓰기는 서버 액션 전용.';

alter table public.calendar_events
  add column if not exists tag_id uuid references public.calendar_tags(id) on delete set null;

comment on column public.calendar_events.tag_id is
  '일정 분류 태그(0224a) — null = 태그 없음. 표시색은 태그색이 일정 색보다 우선(앱 규칙).';

-- 태그별 필터·집계가 새 접근 축 — 태그 없는 일정은 인덱스에 안 담는다.
create index if not exists calendar_events_tenant_tag_idx
  on public.calendar_events (tenant_id, tag_id)
  where tag_id is not null;

alter table public.calendar_tags enable row level security;

-- 읽기 = 테넌트 전원(calendar_events와 같은 결 — 학원 일정 분류는 공용 정보). 쓰기 정책 없음(서버 액션 전용).
drop policy if exists calendar_tags_tenant_read on public.calendar_tags;
create policy calendar_tags_tenant_read on public.calendar_tags
  for select
  using (tenant_id = public.auth_tenant_id());

drop trigger if exists calendar_tags_set_updated_at on public.calendar_tags;
create trigger calendar_tags_set_updated_at
  before update on public.calendar_tags
  for each row execute function public.tg_set_updated_at();

notify pgrst, 'reload schema';
