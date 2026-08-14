-- 0210a — 당일 출결 확인 후속조치(데스크 연락 기록) — 2026-08-14.
--
-- 배경(원장 2026-08-14): *"수업보고서로 출석체크를 하니 당일 바로 처리가 안 되고, 다음날 발송하는
-- 강사도 있다. 당일 선생님별 출석부가 있어야겠고, 출석하지 않은 학생이 데스크에 연동돼 학부모·학생
-- 확인이 바로 이어지게."*
--
-- 실측(프로덕션, 2026-08-14):
--   · 최근 60일 `present` 2,615건 중 **1,971건(75%)이 수업 다음날 이후** 기록(당일은 25%).
--   · 수업이 열렸는데 출결이 한 행도 없는 비율 = 최근 28일 901 반×날짜 중 **557건(61.8%)**
--     (영어 91.6% / 수학 30.2%). 하루 200명 넘는 등원 여부가 시스템에 남지 않는다.
--   · 강사별 당일 기록률: 6%(기록 중앙값 새벽 01:49)~100%로 극단 분포.
--
-- 🔑 **이 표는 "큐"가 아니라 "조치 기록"이다.** 미확인 학생 목록은 파생 계산(시간표 × 수강 × 출결)이라
--    저장하지 않는다. 미리 행을 만들어 두면 매일 200행씩 쓰레기가 쌓이고, 사람이 손대지 않은 행과
--    손댄 행이 섞여 "처리했는지"를 알 수 없게 된다. **데스크가 처음 손대는 순간에만** 행이 생긴다.
--
-- 🔴 **출결 자체는 여기서 바꾸지 않는다.** `attendance_records`는 시수(session_units)·단가(salary_tier)를
--    통해 급여·청구로 흘러가는 표다(골든마스터 대상). 데스크의 전화 한 통이 강사 급여를 조용히 바꾸면
--    안 된다 → 이 표는 "무슨 연락을 했고 답이 무엇이었나"만 담고, 출결 반영은 사람이 버튼을 눌러
--    기존 게이트(`setAttendanceCell`)를 그대로 통과한다.
--
-- ⚠️ **RLS는 tenant_isolation 하나만 건다(의도적 — #92 규약대로 여기 적는다).** 역할 게이트를 DB로
--    내리지 않는 이유:
--      ① 원본인 `attendance_records`가 지금 tenant_isolation 하나뿐이다. 파생 기록만 더 잠그면
--         비대칭이고 실익이 없다(같은 사실을 원본에서 읽을 수 있다).
--      ② `auth_menu_access(p_menu)`의 DEFAULTS jsonb에는 billing·expense_requests·staff·
--         textbook_requests **4개뿐**이라(0170a) 'attendance'를 부르면 master 빼고 전원 'none'이 되어
--         fail-closed 락아웃이 된다(#60·#92). 여기에 attendance 행을 더하는 것은 **출결 계열 전체를
--         DB로 잠그는 별도 작업**이고, 그때는 `attendance_records`와 이 표를 함께 넣어야 한다.
--         (0170a의 `auth_menu_access`는 개인 예외(userOverrides)를 master>개인>역할>기본값 순으로
--          정상 반영한다 — 개인 예외가 SQL에서 안 통한다는 뜻이 아니다.)
--    → 역할 게이트는 앱 레이어 단일 소스(`canWriteTenant("attendance")` / `accessLevelTenant`)가 진다.
--       그쪽은 역할 override와 개인 예외를 모두 본다.
--
-- 배포 순서: **이 SQL 먼저, 앱은 그 다음**(#95 — 앱이 이 표를 select 한다. 표가 없으면 데스크 화면이 죽는다).
-- 롤백: `drop table if exists attendance_followups;` (다른 표를 건드리지 않는다).

create table if not exists attendance_followups (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  student_id    uuid not null references students(id) on delete cascade,
  class_id      uuid not null references classes(id) on delete cascade,
  session_date  date not null,
  -- 교시("HH:MM"). null = 그날 전체(0196a 이전 세대 기록과 같은 규약).
  slot_start    time,
  -- 행이 생길 때의 신호(absent | unmarked) — 사후에 "왜 전화했나"를 되짚는 근거. 파생값이라 갱신하지 않는다.
  signal        text not null check (signal in ('absent', 'unmarked')),
  -- open=연락 중/대기, resolved=매듭지음, dismissed=확인 불필요(오탐·이미 등원 등)
  state         text not null default 'open' check (state in ('open', 'resolved', 'dismissed')),
  -- 연락 결과. 🔴 출결 상태와 1:1이 아니다 — 'no_answer'는 "안 왔다"는 뜻이 아니다.
  outcome       text check (outcome in ('coming', 'absent_today', 'sick', 'already_here', 'no_answer', 'other')),
  note          text,
  contacted_via text check (contacted_via in ('phone', 'kakao', 'in_person', 'other')),
  handled_by    uuid references users(id) on delete set null,
  handled_at    timestamptz,
  created_by    uuid references users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- 한 학생·한 날·한 교시에 조치는 하나.
-- ⚠️ 키에 `class_id`가 **일부러 빠져 있다** — 실데이터엔 "한 수업, 두 수강행"(같은 학생이 같은 요일에 두
--    반에 걸린 형태)이 있어 반을 키에 넣으면 같은 시각·같은 아이에게 조치가 두 개 생기고, 데스크가 같은
--    집에 두 번 전화한다. 데스크가 답해야 할 질문은 "이 아이가 그 시간에 왔나" 하나다(어느 반인지는
--    행의 class_id에 남는다).
-- ⚠️ `nulls not distinct`가 핵심이다(PG 15+, 이 DB는 17.6). 기본 규칙에선 null끼리 서로 다르게 취급돼
--    "그날 전체"(slot_start = null) 조치가 **같은 칸에 여러 행** 생긴다 = 데스크가 같은 집에 두 번 전화한다.
-- ⚠️ 표현식(coalesce)이 아니라 **컬럼 목록** 유니크여야 PostgREST upsert가 `onConflict`로 지목할 수 있다
--    (표현식 인덱스는 지목 불가 → 저장이 조용히 중복 행을 만든다).
create unique index if not exists attendance_followups_cell_uq
  on attendance_followups (tenant_id, student_id, session_date, slot_start) nulls not distinct;

-- 데스크 화면의 주 조회 = "오늘 우리 학원 조치들". 날짜 역순으로 훑는다.
create index if not exists attendance_followups_tenant_date_idx
  on attendance_followups (tenant_id, session_date desc);

-- 학생 상세에서 "이 아이 결석 연락 이력"을 뽑는 경로.
create index if not exists attendance_followups_student_idx
  on attendance_followups (tenant_id, student_id, session_date desc);

alter table attendance_followups enable row level security;

drop policy if exists attendance_followups_tenant_isolation on attendance_followups;
create policy attendance_followups_tenant_isolation on attendance_followups
  for all using (tenant_id = auth_tenant_id()) with check (tenant_id = auth_tenant_id());

-- ⚠️ 나중에 출결 계열에 역할 게이트를 붙일 땐 **이 표도 함께** 넣을 것 — 통화 메모·`outcome='sick'`은
--    기존 출결 계열에 없던 종류의 개인정보다(0158a가 billing 계열만 잠갔던 것과 같은 누락을 막는다).
comment on table attendance_followups is
  '당일 미확인·결석 학생에 대한 데스크 확인 기록(0210a). 큐 자체는 파생 계산이고 이 표는 조치만 담는다. 출결(attendance_records)은 여기서 바꾸지 않는다 — 급여·청구 재료라 사람이 명시로 반영한다.';
comment on column attendance_followups.signal is
  '행 생성 시점의 신호(absent=강사가 결석 입력 / unmarked=같은 교시 다른 학생은 입력됐는데 이 학생만 빈 칸). 파생값이라 이후 갱신하지 않는다.';
comment on column attendance_followups.outcome is
  '연락 결과. 출결 상태와 1:1이 아니다 — no_answer/coming/other는 출결을 바꿀 근거가 되지 않는다.';
