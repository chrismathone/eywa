-- 0134a: teacher_schedule_blocks — 강사 시간표의 **비수업 블록**(감독·준비·회의·연차·쉬는 시간).
--
-- 왜 필요한가 (2026-07-22, 원장 "강사뷰를 시트와 완전히 일치하게"):
--   영어 마스터 시트의 강사별 탭은 **강사의 하루 전체**를 그린다 — 수업 칸 사이사이에 'JJ'(= JJ 수업
--   감독하러 감)·'쉬는 시간'·'수업준비'·'교수부미팅'·'연차사용'이 들어 있다. eywa 시간표는 **수업만**
--   담아서, 이 칸들이 갈 곳이 없어 가져오기에서 통째로 버려졌다(실측 감독만 34칸: Dom 15·Daniella 11·
--   Hannah 8). 그래서 Dom의 시간표가 슬롯 1개로 텅 비어 보였다.
--
-- ⚠️ 왜 '반'으로 만들지 않는가 (원장 지시: "기존과 다른 유형의 반은 필요없음"):
--   · 감독 칸 1개가 JJ 수업 **0~5개**에 걸친다(LAB에서 여러 반이 동시에 돎) — "어느 반의 강사"로
--     환원되지 않는다. 아무 반에나 붙이면 그 강사가 **그 반 학생의 담당**이 되어 원스크린 로스터·
--     수업보고서 대상·강사 스코프까지 끌려온다(교차오염).
--   · classes에 새 유형을 만들면 수업목록·수강·청구·급여가 전부 이 가짜 반을 보게 된다.
--   → 반이 아닌 **별도 테이블**. 수강(enrollments)·청구·급여 어디에도 조인되지 않는다.
--     소비처는 **강사뷰 렌더 하나뿐**이다(그 외에서 이 테이블을 읽지 말 것).
--
-- temporal 모델은 class_schedules와 동일(valid_from/valid_to) — 시트 컷오버가 수업과 같은 날짜 경계로
-- 이 블록도 갈아끼울 수 있어야 한다(마감=valid_to, 신규=valid_from. 삭제하지 않아 타임머신 보존).
--
-- teacher_label이 진실이고 teacher_id는 **해석되면 채우는 보조**다 — 시트에는 계정 없는 강사(라벨만)도
-- 나오고, 계정이 나중에 생겨도 그림은 그대로여야 한다(class_schedules.slot_teacher_label과 같은 규약).
--
-- 롤백 = drop table public.teacher_schedule_blocks;

create table if not exists public.teacher_schedule_blocks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- 과목 스코프 — 현재 english 전용이나, 다른 과목이 같은 시트 문법을 쓰면 그대로 확장된다.
  subject text not null,
  -- 표시 앵커. 라벨이 진실(계정 없는 강사도 그린다), id는 해석되면 채우는 보조.
  teacher_label text not null,
  teacher_id uuid references public.users(id) on delete set null,
  day_of_week public.day_of_week not null,
  start_time time not null,
  end_time time not null,
  -- 블록 종류. 'supervise'=다른 강사 수업 감독(시트 셀이 그 강사 이름 한 단어).
  kind text not null default 'other'
    constraint teacher_schedule_blocks_kind_check
    check (kind in ('supervise', 'prep', 'break', 'meeting', 'leave', 'other')),
  -- 화면에 그대로 찍는 문구 = 시트 원문("JJ"·"쉬는 시간"). 번역·정규화하지 않는다(시트 일치가 목적).
  label text not null,
  valid_from date not null,
  valid_to date,
  created_at timestamptz not null default now(),
  constraint teacher_schedule_blocks_time_order check (end_time > start_time),
  constraint teacher_schedule_blocks_valid_order check (valid_to is null or valid_to >= valid_from)
);

comment on table public.teacher_schedule_blocks is
  '강사 시간표의 비수업 블록(감독·준비·회의·연차·쉬는 시간) — 반이 아니다. 소비처는 시간표 강사뷰 렌더뿐이고 수강·청구·급여와 조인되지 않는다(0134a).';
comment on column public.teacher_schedule_blocks.teacher_label is
  '시트 강사 블록 이름. 이 값이 표시 앵커의 진실 — teacher_id는 해석됐을 때만 채우는 보조.';
comment on column public.teacher_schedule_blocks.label is
  '화면에 그대로 찍는 시트 원문("JJ"·"쉬는 시간"). 정규화 금지 — 시트와 같아 보이는 게 목적.';

-- 강사뷰 조회 = (tenant, subject, 유효기간) → 라벨/요일. 유효행만 좁히는 부분 인덱스.
create index if not exists teacher_schedule_blocks_lookup_idx
  on public.teacher_schedule_blocks (tenant_id, subject, valid_from)
  where valid_to is null;

alter table public.teacher_schedule_blocks enable row level security;

-- class_schedules와 동일한 테넌트 격리(시간표를 볼 수 있는 사람은 이 블록도 본다 — PII 없음).
drop policy if exists teacher_schedule_blocks_tenant_isolation on public.teacher_schedule_blocks;
create policy teacher_schedule_blocks_tenant_isolation on public.teacher_schedule_blocks
  for all
  using (tenant_id = public.auth_tenant_id())
  with check (tenant_id = public.auth_tenant_id());
