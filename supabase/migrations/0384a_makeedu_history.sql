-- 0384a — 메이크에듀 과거 이력(원장 2026-10-20 *"확보가능한 도움 되는 데이터 전부 넣기. 대신 병목현상으로 느려지지않게"*).
--
-- 에이와는 2026-01부터의 수강·청구·출결만 정확하다(그 전에 그만둔 학생은 수강 행이 없다 — 0381a 주석). 메이크에듀엔 그 전 기록이
-- 남아 있다(2026-10-20 사이트 조사 `makeedu-stats-audit/.audit/MAKEEDU_SITE_MAP.md`): 수납 상세 2020-01~(학생 × 청구월 × 수납명) ·
-- 원생이력 2025-03~(반 추가·이동·제외·퇴원 사건) · 퇴원생 목록(입학일·퇴원일·사유). 한 번만 채우면 되는 지난 기록이라
-- 동기화 PC 워커를 늘리지 않고 한 번 수집해 넣는다.
--
-- 🔴 운영 표(students·enrollments·invoices)에는 넣지 않는다 — 수납 화면·미납·운영실 숫자가 바뀌거나 느려지지 않게 **따로 된 이력 표**에만.
--   makeedu_history_students  메이크에듀 원생(전체 상태) — 원생고유번호 · 에이와 학생 연결 · 메이크에듀 입학일·퇴원일·퇴원 사유
--   makeedu_history_bills     수납 상세 한 줄(학생 × 청구월 × 순번) — 수업/기타 · 수납명 · 금액 · 수납 여부·일. 메모(카드 승인번호)는 넣지 않는다.
--   makeedu_history_events    원생이력 사건 한 줄 — 처리 시각 · 사건 종류 · 수업명 · 강사(표시 이름) · 휴퇴원일 원문
-- 이름·연락처·메모는 넣지 않는다(학생은 원생고유번호로 잇는다). 퇴원 사유는 분류 이름만('기타(서술)'은 '기타'로).
-- 🔴 원자료 그대로 보관한다 — 2024-03-18 하루 4,014명(이관 때 찍힌 일괄 퇴원일)·청구 방식이 바뀐 2025-04처럼 추세에 그대로 쓰면
--   틀리는 줄도 지우지 않는다. 추세에서 빼는 판단(원장 2026-10-20 *"단체 정리 등 배제할 건은 배제시키기"*)은 읽는 쪽이 한다.
-- 화면이 읽을 월별 집계 표는 화면 방식을 정할 때 따로 만든다(무거운 계산은 넣을 때 한 번만 — 이 원자료 표를 화면이 직접 훑지 않는다).
--
-- 🔴 서버 전용(정책 0개 · 0374a·0376a·0377a·0381a와 같은 방식) — 화면은 권한 확인 뒤 관리 키 + tenant_id로 읽는다. 사람이 쓰는 길은 없다.
-- 배포 순서: 앱보다 먼저(#95). 넣는 일은 운영자 스크립트(한 번) — 다시 돌려도 같은 결과(기본키 upsert).
-- 되돌리기: drop table public.makeedu_history_events, public.makeedu_history_bills, public.makeedu_history_students;

create table if not exists public.makeedu_history_students (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  makeedu_no text not null,
  student_id uuid references public.students(id) on delete set null,
  enrolled_on date,
  withdrawn_on date,
  withdrawal_reason text,
  imported_at timestamptz not null default now(),
  primary key (tenant_id, makeedu_no)
);
comment on table public.makeedu_history_students is '메이크에듀 원생(전체 상태) — 원생고유번호·에이와 학생 연결·입학일·퇴원일·사유. 이름·연락처 없음. 0384a.';

create table if not exists public.makeedu_history_bills (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  makeedu_no text not null,
  bill_month date not null,
  seq integer not null,
  item_kind text not null check (item_kind in ('lesson', 'other')),
  category text,
  item_name text,
  paid_status text,
  billed integer not null default 0,
  discount integer not null default 0,
  points integer not null default 0,
  paid integer not null default 0,
  unpaid integer not null default 0,
  pay_method text,
  paid_on date,
  refunded boolean not null default false,
  partial boolean not null default false,
  primary key (tenant_id, makeedu_no, bill_month, seq)
);
create index if not exists makeedu_history_bills_month_idx on public.makeedu_history_bills (tenant_id, bill_month);
comment on table public.makeedu_history_bills is '메이크에듀 수납 상세(학생×청구월×순번) — 수업/기타·수납명·금액·수납 여부. 메모(카드 승인번호) 없음. 0384a.';

create table if not exists public.makeedu_history_events (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  makeedu_no text not null,
  processed_at timestamptz not null,
  ord integer not null,
  event_type text not null,
  class_name text,
  teacher_name text,
  effective_text text,
  primary key (tenant_id, makeedu_no, processed_at, ord)
);
create index if not exists makeedu_history_events_time_idx on public.makeedu_history_events (tenant_id, processed_at);
comment on table public.makeedu_history_events is '메이크에듀 원생이력 사건(처리 시각·종류·수업명·강사 표시 이름·휴퇴원일 원문). 같은 학생·같은 시각 사건은 ord로 가른다. 0384a.';

alter table public.makeedu_history_students enable row level security;
alter table public.makeedu_history_bills enable row level security;
alter table public.makeedu_history_events enable row level security;
revoke all on public.makeedu_history_students, public.makeedu_history_bills, public.makeedu_history_events from public, anon, authenticated;
grant all on public.makeedu_history_students, public.makeedu_history_bills, public.makeedu_history_events to service_role;
