-- 0230a — ECS 교시 단위 체크 표시(우선 'Shouting' 하나)
--
-- 원장 지시(2026-08-27): *"EiE는 샤우팅 체크박스로 변경 · 각 반이 샤우팅 했는지 체크박스로 체크할 수 있게"*
-- (인재원 영어는 샤우팅 자체가 필요 없어 **구분 영역에서 제거**했고, EiE 반만 이 체크를 쓴다.)
--
-- 왜 새 표인가: 이 값은 계획 줄(class_sheet_plan_lines)도 학생 기록(class_sheet_student_marks)도 아닌
-- **그 반이 그 날 그 교시에 했는가**라 축이 다르다. 계획 줄에 얹으면 줄이 없는 교시엔 적을 데가 없고,
-- 학생 기록에 얹으면 학생마다 중복된다.
--
-- ⚠️ 접근은 0157a 계열과 **같은 규약**: RLS 켜고 정책 0개 + service_role 전용 grant([[#104]]).
--    유일한 권한 판정은 앱의 `requireEcsClassAccess`다(#77 — 표면이 늘어도 게이트는 하나).
-- ⚠️ 유니크는 **부분(WHERE) 인덱스가 아니다** — upsert의 on conflict 추론이 깨지기 때문([[#113]]).

create table if not exists class_sheet_slot_flags (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  class_id uuid not null,
  flag_date date not null,
  slot_start time not null,                 -- 교시 블록의 start_time(계획 줄과 같은 앵커)
  shouting boolean not null default false,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, class_id, flag_date, slot_start)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'class_sheet_slot_flags_class_fk') then
    alter table class_sheet_slot_flags
      add constraint class_sheet_slot_flags_class_fk
      foreign key (tenant_id, class_id) references classes (tenant_id, id) on delete cascade;
  end if;
end $$;

-- 조회는 항상 (반, 날짜 범위) — 주간 시트 한 주 / 오늘 보드 하루.
create index if not exists class_sheet_slot_flags_class_date_idx
  on class_sheet_slot_flags (tenant_id, class_id, flag_date);

alter table class_sheet_slot_flags enable row level security;
revoke all on table class_sheet_slot_flags from public, anon, authenticated;
grant all on table class_sheet_slot_flags to service_role;

comment on table class_sheet_slot_flags is
  'ECS 교시 단위 체크(현재 shouting 하나). 앵커=반+날짜+교시 시각. service_role 전용(RLS 정책 0) — 게이트는 requireEcsClassAccess.';
