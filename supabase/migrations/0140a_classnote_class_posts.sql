-- 0140a: ClassNote 반 단위 알림장 작성 기록 — **영어 작성률 측정용** (2026-07-23).
--
-- 왜: 영어 강사는 eywa/Edutrix가 아니라 **ClassNote에 직접** 알림장을 쓴다. 그래서 `lesson_reports`
-- 기반 작성률에 영어가 0건으로 잡힌다(실제로는 66% 쓰고 있는데도).
--
-- 왜 저장해야 하나: ClassNote 피드는 **페이지 상한(3,000건) 때문에 최근 약 3주치만** 조회된다.
-- 시간이 지나면 오늘 데이터도 못 본다. 화면에서 부를 수도 없다 — 피드 조회는 Playwright 세션이
-- 필요하고 그 자격증명은 연동 PC에만 있다(서버 컴포넌트가 브라우저를 띄울 수 없음).
-- → **워커가 긁을 때 적재**하고 화면은 DB만 읽는다. 한 번 저장되면 상한과 무관하게 영구 보존.
--
-- ⚠️ **한시적 다리다.** 원장 방침상 영어도 결국 eywa에서 발송된다(그때는 `lesson_reports`에 남으므로
--    이 테이블 없이 자연히 카운트된다). 그래서 의도적으로 최소 스키마 — 나중에 지우기 쉽게.
--
-- 한 행 = "그 반 보드에 그 날 알림장이 올라왔다". 복합 PK가 곧 멱등키라 워커가 30분마다 같은 창을
-- 다시 긁어도 upsert로 덮어쓸 뿐 중복이 안 생긴다.
-- ⚠️ drizzle journal 밖(손수 alpha). 신규 DB는 pnpm db:alphas가 사전순 적용.

create table if not exists classnote_class_posts (
  tenant_id uuid not null references tenants(id) on delete cascade,
  -- ClassNote 보드 이름 **원문**(`Elsa 초등 브릿지D (화수금)` / `[EIE] Let's Talk 4 (…)`).
  -- eywa 반 id로 정규화하지 않는다 — 매칭 규칙이 바뀌어도 원본이 남아 재계산할 수 있다.
  board_name text not null,
  posted_on date not null,                 -- KST 기준 작성일
  post_count int not null default 1,       -- 그날 그 보드에 올라온 글 수(참고용, 작성률은 날짜로 센다)
  updated_at timestamptz not null default now(),
  primary key (tenant_id, board_name, posted_on)
);

create index if not exists classnote_class_posts_tenant_day_idx
  on classnote_class_posts (tenant_id, posted_on desc);

alter table classnote_class_posts enable row level security;

-- 읽기 = 테넌트 멤버(작성률 화면). 쓰기 = 워커(service_role)만 — insert/update 정책 없음.
drop policy if exists classnote_class_posts_tenant_read on classnote_class_posts;
create policy classnote_class_posts_tenant_read on classnote_class_posts
  for select using (tenant_id = auth_tenant_id());

comment on table classnote_class_posts is
  'ClassNote 반 보드 알림장 작성일(영어 작성률용). 피드 3주 상한을 넘어 보존하려고 워커가 적재. 영어가 eywa 발송으로 전환되면 폐기 대상.';
