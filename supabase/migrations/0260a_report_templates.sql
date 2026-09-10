-- 0260a — 수업보고서 **사용자 템플릿** (영어부터)
--
-- 사용자 2026-09-10: *"템플릿 관리주체는 ecs자동이 기본 하나, 각 사용자가 정하는 템플릿 … 변수명으로 학생이름
-- 자동 템플릿에서 쓰면 반영되고 … 사용자 템플릿 각 추가해서 쓸꺼임"*.
-- 기본 템플릿은 코드(src/features/report-templates/defaults.ts)가 주고, 이 표는 **사람마다 여러 개**인
-- 사용자 템플릿만 담는다. 교재 멘트(users.textbook_notice_ment)는 1인 1개라 칸 하나로 됐지만 여러 개는 표가 필요하다.
--
-- 🔑 subject 칸을 둔다 — 지금은 영어뿐이지만 수학에도 템플릿을 붙일 때 표를 다시 파지 않게.
-- 🔑 본문의 토큰은 **저장 전에** 검사한다(validate.ts — 모르는 칸이면 거절). DB는 길이만 막는다.
-- 🔴 읽기·쓰기 정책을 두지 않는다 — 서버 액션(service_role)만 읽고 쓴다([[#104]] 규약: admin 클라이언트 +
--    tenant_id·owner_id 명시 필터). 내 템플릿은 나만 쓰는 것이라 남의 템플릿이 PostgREST로 보일 이유가 없다.
--    정책이 0개인 것은 **의도적**이다([[#92]] "의도적 제외는 마이그레이션에 적는다").
-- 🔴 유니크에 WHERE를 붙이지 않는다([[#113]]).
-- ⚠️ 앱은 이 표가 **없어도 돌아간다**([[#95]]) — 템플릿 목록은 기본 템플릿만 보여 주고, 저장 버튼만
--    "아직 준비 중"이라고 말한다. 원스크린 첫 화면은 이 표를 읽지 않는다(목록은 템플릿 칸을 열 때 가져온다).
-- ⚠️ 번호: 처음엔 0255a였으나 같은 날 main에 다른 작업의 마이그레이션이 먼저 들어가 뒤로 옮겼다(번호는 병합 직전에 확정).
--
-- 롤백: drop table if exists public.report_templates;
set local statement_timeout = '60s';

create table if not exists public.report_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- 템플릿 주인. 내 템플릿은 나만 보고 고친다.
  owner_id uuid not null references public.users(id) on delete cascade,
  -- 과목 표준 키(지금은 'english'만 쓴다).
  subject text not null default 'english',
  name text not null
    constraint report_templates_name_len check (char_length(btrim(name)) between 1 and 40),
  body text not null
    constraint report_templates_body_len check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.report_templates is
  '수업보고서 사용자 템플릿(사람마다 여러 개). 기본 템플릿은 코드(defaults.ts)가 준다. 서버 액션 전용(정책 0개 = 의도). 0260a';

create unique index if not exists report_templates_owner_name_uniq
  on public.report_templates (tenant_id, owner_id, subject, name);

alter table public.report_templates enable row level security;

notify pgrst, 'reload schema';
