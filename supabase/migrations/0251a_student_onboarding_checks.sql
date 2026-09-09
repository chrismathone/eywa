-- 0251a — 신규생 관리 체크리스트 (신입 등록 후 7·30·60·90일)
--
-- 원장(2026-09-09): *"신규생 관리 탭을 신설할건데, 신입 등록부터 3개월까지 7일, 30일, 60일, 90일 까지
-- 관리하는거야. 각종 지표를 바로 확인하게해서 신입생이 잘 관리되고 있는가 체크하게 하는것."*
-- 체크리스트 = 사전 콜 · 첫 수업 교재/과제/교실 안내 · OJT · 첫 수업 후 상담 콜 · 1개월 만족도 콜 ·
-- (필요시) 2개월 · 3개월 만족도 콜.
--
-- 🔑 구조 결정:
--   ① **한 학생 × 한 항목 = 한 행**(EAV가 아니라 좁은 표). 항목이 7개뿐이라 컬럼 7개도 가능하지만,
--      항목이 늘 때마다 ALTER가 필요하고 "누가·언제 했나"를 항목마다 3열씩 달아야 한다.
--   ② 완료 표식은 **`done_on` date**다(boolean 아님) — "언제 했나"가 곧 지표이고, 사람이 뒤늦게
--      기록할 때 실제 날짜를 적을 수 있어야 한다. 행이 없으면 미완료(빈 행을 미리 만들지 않는다).
--   ③ 기한은 **저장하지 않는다** — 등록일·첫 수업일에서 앱이 도출한다
--      (src/features/newcomers/onboarding-items.ts). 저장하면 등록일이 정정될 때 조용히 어긋난다.
--   ④ `item_key`는 앱 상수와 같은 글자다. 🔴 라벨을 바꿔도 key는 바꾸지 말 것(기록이 끊긴다 —
--      과목 `subjects[].key`·재고 분류 key와 같은 규약).
--
-- 🔴 유니크는 **부분 유니크(WHERE)가 아니라 일반 유니크**다 — 앱이 이 축으로 upsert한다([[#113]]:
--    부분 유니크는 `on conflict (컬럼)` 추론이 안 돼 전건 42P10으로 실패한다).
-- 🔴 `auth_menu_access('newcomers')`를 RLS에 쓰지 말 것 — 0170a DEFAULTS jsonb에 없는 키라 master 빼고
--    전원 'none'이 되어 fail-closed로 잠긴다([[#92]]). 읽기는 테넌트 격리, 쓰기는 앱 게이트
--    (canWriteTenant("newcomers"))가 맡고 서버 액션(service_role)이 쓴다 — 0242a·0247a와 같은 결.
-- 🔴 정책을 하나도 안 만들면 **에러 없이 0행**이 된다([[#104]]) → select 정책을 반드시 만든다.
--
-- ⚠️ 앱은 이 SQL 적용 전에도 죽지 않는다([[#95]]) — 표가 없으면 목록은 **체크 0개 상태로 그대로 뜨고**
--    체크 저장만 잠긴다(한글 배너가 그 사실을 적는다). 운영실 신호도 그때는 조용하다.
--
-- 롤백:
--   drop table if exists public.student_onboarding_checks;
set local statement_timeout = '60s';

create table if not exists public.student_onboarding_checks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  -- 앱 상수(onboarding-items.ts ONBOARDING_ITEMS[].key)와 같은 글자. 확정 후 불변.
  item_key text not null constraint student_onboarding_checks_item_fmt
    check (item_key ~ '^[a-z][a-z0-9_]{0,31}$'),
  -- 완료일. null이면 행이 있어도 미완료(메모만 적어 둔 경우).
  done_on date,
  -- 누가 처리했나 — 계정이 지워져도 기록은 남는다.
  done_by uuid references public.users(id) on delete set null,
  memo text constraint student_onboarding_checks_memo_len
    check (memo is null or char_length(memo) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 🔴 일반 유니크(부분 유니크 금지, [[#113]]) — 앱이 이 축으로 upsert한다.
  constraint student_onboarding_checks_uniq unique (tenant_id, student_id, item_key)
);

comment on table public.student_onboarding_checks is
  '신규생 관리 체크리스트(0251a). 한 학생 × 한 항목 = 한 행. 기한은 저장하지 않고 등록일·첫 수업일에서 앱이 도출한다.';

-- 목록 화면이 "이 테넌트의 최근 신입 N명" 체크를 한 번에 읽는다.
create index if not exists student_onboarding_checks_tenant_student_idx
  on public.student_onboarding_checks (tenant_id, student_id);

alter table public.student_onboarding_checks enable row level security;

drop policy if exists student_onboarding_checks_tenant_read on public.student_onboarding_checks;
create policy student_onboarding_checks_tenant_read on public.student_onboarding_checks
  for select using (tenant_id = public.auth_tenant_id());

drop trigger if exists student_onboarding_checks_set_updated_at on public.student_onboarding_checks;
create trigger student_onboarding_checks_set_updated_at before update on public.student_onboarding_checks
  for each row execute function public.tg_set_updated_at();
