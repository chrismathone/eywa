-- 0145a: eywa 학생 ↔ ClassNote 원아 **고정 연결(pin)** (2026-07-23, 원장 지시).
--
-- 왜: 반 보드 발송은 보드 안에서 원아를 **이름으로** 골라야 하는데, 원아명은 학부모가 등록한 것이라
-- eywa 학생명과 다를 수 있다(실측: eywa `박서연E` ↔ ClassNote `서연`). 그렇다고 `students.classnote_name`을
-- 바꾸면 **1인 보드 이름**(`(수학)박서연E`)이 함께 바뀌어 수학 발송이 깨진다 — 한 칸이 두 용도를 겸하기 때문.
--
-- 해법: 이름을 맞추려 들지 말고 **원아 id를 못 박는다.** 보드가 정해져 있고(반) 그 안의 원아 목록도
-- 0142a로 적재돼 있으니, "이 학생 = 이 원아"를 한 번 확정하면 이름 매칭이 아예 필요 없다.
-- 부수효과: 학부모가 등록명을 바꿔도 안 깨진다(id는 불변). `classnote_name`은 1인 보드 이름 용도만 남는다.
--
-- ⚠️⚠️ **오발송이 이 테이블의 유일한 위험이다**(원장 "아주 꼼꼼해야 함"). 그래서:
--   · 연결은 **사람이 누른 것만** — 자동 추론 금지. 누가 언제 눌렀는지 남긴다.
--   · 서버 액션이 **생년 대조**를 강제한다(학년에서 역산, ±1년). 생년을 모르면 **거부**(모르면 안 한다).
--   · 아래 unique 인덱스가 **한 원아 = 한 학생**을 DB에서 강제한다(화면 실수로도 겹칠 수 없게).
--   · 읽는 쪽은 매번 **재검증**한다 — 그 원아가 아직 그 보드에 있고, 학생이 아직 그 반 재원인지.
--     어긋나면 연결을 **무시**하고 미배정으로 되돌린다(fail-safe: 의심스러우면 안 보낸다).
-- ⚠️ drizzle journal 밖(손수 alpha). 신규 DB는 pnpm db:alphas가 사전순 적용.

create table if not exists classnote_student_links (
  tenant_id uuid not null references tenants(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  -- 보드 단위로 못 박는다 — 한 학생이 여러 반 보드에 있을 수 있다(과목·이동반).
  board_id bigint not null,
  child_id bigint not null,
  -- 연결 당시의 원아명·생년. 나중에 값이 바뀌면 화면이 "바뀌었다"고 밝힌다(조용히 넘어가지 않게).
  child_name_at_link text not null,
  birth_year_at_link int,
  linked_by uuid references users(id) on delete set null,
  linked_at timestamptz not null default now(),
  primary key (tenant_id, student_id, board_id)
);

-- 🔴 한 보드의 한 원아는 **한 학생에게만** 연결된다. 두 학생이 같은 원아를 가리키면
--    한쪽 보고서가 남의 집으로 간다 — 화면 로직이 실수해도 DB가 막는다.
create unique index if not exists classnote_student_links_child_uniq
  on classnote_student_links (tenant_id, board_id, child_id);

alter table classnote_student_links enable row level security;

drop policy if exists classnote_student_links_tenant_read on classnote_student_links;
create policy classnote_student_links_tenant_read on classnote_student_links
  for select using (tenant_id = auth_tenant_id());

-- 쓰기도 테넌트 안에서 허용하되, **권한 판정은 서버 액션**이 한다(canWriteTenant('lesson_reports')).
-- RLS는 테넌트 격리 담당 — 메뉴 권한은 RLS가 알 수 없으므로 액션과 2중으로 건다.
drop policy if exists classnote_student_links_tenant_write on classnote_student_links;
create policy classnote_student_links_tenant_write on classnote_student_links
  for insert with check (tenant_id = auth_tenant_id());

drop policy if exists classnote_student_links_tenant_delete on classnote_student_links;
create policy classnote_student_links_tenant_delete on classnote_student_links
  for delete using (tenant_id = auth_tenant_id());

comment on table classnote_student_links is
  'eywa 학생 ↔ ClassNote 원아 고정 연결(반 보드 발송용). 사람이 확인해 누른 것만 저장하며, 읽을 때 매번 재검증한다.';
