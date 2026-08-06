-- 0185a — 원아 매핑을 **여러 원아 → 한 학생**으로 (2026-08-06, 0184a 직후 정정).
--
-- 0184a는 `students.classnote_child_id` **단일 컬럼**으로 원아를 붙였다. 실데이터를 돌려보니 그 전제가 틀렸다:
-- **한 아이가 ClassNote 계정을 2개 갖는 게 정상**이다(수학·영어를 따로 가입 / 학부모·학생이 각자 가입).
-- 실측(원아 474명, 2026-08-06): **16쌍 32명**이 같은 아이의 두 계정이었다 —
--   `강민준(2015-12-18)` × 2 · `이재용` ↔ `Lincoln(이재용)`(생년 동일) · `이재희` ↔ `Jay(이재희)` …
-- 단일 컬럼이면 둘 중 하나만 붙고 **나머지 계정으로 들어온 학부모 연락은 학생을 못 찾는다**(= 그 아이가
-- 출결 명단에서 조용히 빠진다). 실제로 그 제약 때문에 확정이 461명 → 429명으로 줄었다.
--
-- → 관계를 제 모양으로 바꾼다: **원아 = 주소, 학생 = 사람.** 주소는 여러 개일 수 있다.
--    · `(tenant, child_id)`가 PK = **한 원아는 한 학생에만** 붙는다(이건 반드시 지켜야 한다 — 어기면 남의 집
--      연락이 섞인다). 반대 방향(한 학생 ↔ 여러 원아)은 **열어 둔다.**
--
-- ⚠️ 0184a의 컬럼은 **백필 후 제거**한다. 남겨 두면 "매핑이 두 군데 있는" 상태가 되어, 나중에 한쪽만 고치는
--    순간 조용히 어긋난다(정답이 둘이면 둘 다 못 믿는다).
-- ⚠️ 연동 PC의 **구워커는 이 컬럼도 표도 모른다** — 0184a·0185a 둘 다 구워커와 무관하게 안전하다.
--    새 워커(zip 재이관)부터 이 표를 읽고 쓴다.
-- 🔴 여기 남는 건 **원아 id(정수)뿐**이다. 대조에 쓴 보호자 전화는 저장하지 않는다(0184a와 같은 원칙).

create table if not exists classnote_child_links (
  tenant_id uuid not null references tenants(id) on delete cascade,
  child_id bigint not null,                                  -- ClassNote 원아 id
  student_id uuid not null references students(id) on delete cascade,
  -- 어떤 근거로 붙였나(phone / phone+name / phone+name+birth / name / name+birth).
  -- 나중에 사람이 "이거 왜 이 학생이지?"를 되짚을 때 이 한 칸이 있고 없고가 큰 차이다.
  linked_by text,
  created_at timestamptz not null default now(),
  primary key (tenant_id, child_id)
);

create index if not exists classnote_child_links_student_idx
  on classnote_child_links (tenant_id, student_id);

comment on table classnote_child_links is
  'ClassNote 원아(child) ↔ eywa 학생. **여러 원아 → 한 학생**(같은 아이의 다계정: 수학·영어 따로 가입 등). 한 원아는 한 학생에만 붙는다(PK). 0185a.';

alter table classnote_child_links enable row level security;

drop policy if exists classnote_child_links_tenant_isolation on classnote_child_links;
create policy classnote_child_links_tenant_isolation on classnote_child_links
  for all
  using (tenant_id = public.auth_tenant_id())
  with check (tenant_id = public.auth_tenant_id());

-- 0184a와 같은 이유로 학생 계정만 차단(직원 전체는 읽을 수 있어야 이 기능이 성립한다).
drop policy if exists classnote_child_links_role_gate on classnote_child_links;
create policy classnote_child_links_role_gate on classnote_child_links
  as restrictive for select to authenticated
  using ((select coalesce(public.auth_system_role(), '')) <> 'student');

-- ── 0184a 컬럼 백필 후 제거 ──────────────────────────────────────────────────
-- (0184a 적용 후 아직 --apply를 안 돌렸다면 0행이다. 멱등하게 짜 두어 어느 쪽이든 안전하다.)
insert into classnote_child_links (tenant_id, child_id, student_id, linked_by)
select tenant_id, classnote_child_id, id, '0184a-backfill'
from students
where classnote_child_id is not null
on conflict do nothing;

drop index if exists students_classnote_child_id_idx;
alter table students drop column if exists classnote_child_id;
