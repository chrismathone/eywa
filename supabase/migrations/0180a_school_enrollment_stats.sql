-- 0180a — 학교별 전교생 수(학년별) 적재 테이블 (2026-08-05).
--
-- 배경(원장 2026-08-05): *"아파트나 전교생 현황을 가져와서 현황지도 만드는것도 재밌을듯"* +
-- *"학년별 전교생수가 필요함. 전체 전교생수도 있으면 더 좋고"*.
-- 목적 = **학교별 점유율**(우리 학생 수 ÷ 전교생 수)과 이후 현황 지도.
--
-- 출처 = 학교알리미 공시 CSV `2026년도_학년별·학급별 학생수(초/중/고)_시도교육청`.
-- 🔴 API가 아니라 CSV인 게 오히려 맞다 — 전교생 수는 **연 1회 갱신**이라 실시간 호출이 낭비다.
--    (NEIS는 학교코드·주소만 주고 전교생 수가 아예 없다. 2026-08-05 반환 필드 전수 확인.)
--
-- 🔴 매칭 키가 **이름뿐**이다. 학교알리미 `정보공시 학교코드`(S000003493)와 NEIS `SD_SCHUL_CODE`
--    (7261042)는 서로 다른 체계라 코드로는 못 잇는다. 그래서 정규화한 이름(`name_key`)을 컬럼으로
--    **저장**한다 — 조회할 때마다 정규화하면 인덱스를 못 타고, 규칙이 바뀌었을 때 무엇이 어떻게
--    묶였는지 되짚을 수 없다. 규칙은 `src/features/schools/school-name.ts`(순수 함수 + 테스트).
--    실측 매칭률: 우리 학교 47종 중 45종(96%), **학생 기준 372/374명(99%)**.
--
-- 테넌트별로 담는 이유: 학원마다 지역이 달라 적재하는 시도교육청 CSV가 다르다. 공공데이터라
-- 민감하진 않지만 이 프로젝트의 "모든 테이블에 tenant_id + RLS" 원칙을 따른다.

create table if not exists school_enrollment_stats (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  year smallint not null,                       -- 공시 연도(2026)
  info_code text not null,                      -- 학교알리미 정보공시 학교코드(S000003493)
  name text not null,                           -- 공시 학교명("대구칠성초등학교")
  name_key text not null,                       -- 정규화 매칭 키("칠성초") — 조회 시 재계산 금지
  kind text not null check (kind in ('초', '중', '고')),
  office text,                                  -- 시도교육청
  district text,                                -- 교육지원청
  region text,                                  -- 지역("대구광역시 북구")
  founding text,                                -- 설립구분(공립/사립/국립)
  total_students integer not null default 0,    -- 학생수(계)
  total_classes integer,                        -- 학급수(계)
  teachers integer,                             -- 교사수
  -- 학년별 학생수 {"1":82,"2":79,…}. 초는 1~6, 중·고는 1~3. 학년 수가 급마다 달라 컬럼 대신 jsonb.
  by_grade jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 같은 연도·같은 학교는 한 행. 재적재는 upsert로 덮어쓴다(멱등).
  unique (tenant_id, year, info_code)
);

-- 점유율 조회는 "이 학원의 그 해 데이터에서 이름으로 찾기"라 이 순서가 그대로 탐색 경로다.
create index if not exists ses_tenant_year_namekey_idx
  on school_enrollment_stats (tenant_id, year, name_key);

alter table school_enrollment_stats enable row level security;

drop policy if exists school_enrollment_stats_tenant_isolation on school_enrollment_stats;
create policy school_enrollment_stats_tenant_isolation on school_enrollment_stats
  for all
  using (tenant_id = auth_tenant_id())
  with check (tenant_id = auth_tenant_id());

comment on table school_enrollment_stats is
  '학교알리미 공시 학년별 전교생 수(연 1회 CSV 적재). 점유율 = 우리 학생 수 ÷ total_students.';
comment on column school_enrollment_stats.name_key is
  '정규화 학교명(school-name.ts). 학교알리미 코드와 NEIS 코드가 달라 이름이 유일한 매칭 키다.';
comment on column school_enrollment_stats.by_grade is
  '학년별 학생수 {"1":82,…}. 초=1~6, 중·고=1~3.';
